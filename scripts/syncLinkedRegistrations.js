/**
 * Sync linked DS registration requests back into the directory.
 *
 * For every ds_registration_requests row with status='linked', copy the details
 * the family supplied on the registration form onto the profiles row it was
 * linked to (first_name, last_name, cellphone, dob), and — when they gave a new
 * email — make sure an auth account exists for it. Existing auth accounts are
 * NEVER deleted.
 *
 * Identity model: portal_id is the unique per-person key and is what everything
 * here matches on. profiles.id is only a pointer to the auth login a person
 * signs in with, and is deliberately shared across a family — so giving someone
 * a new email means creating the auth account and pointing their profiles.id at
 * it. The previous auth account is left in place.
 *
 * Usage:
 *   node scripts/syncLinkedRegistrations.js                  # dry run (default)
 *   node scripts/syncLinkedRegistrations.js --apply          # write changes
 *   node scripts/syncLinkedRegistrations.js --apply --force-dob
 *   node scripts/syncLinkedRegistrations.js --apply --no-relink
 *
 * Flags:
 *   --apply       Actually write. Without it nothing is modified.
 *   --force-dob   Also apply birthdays that failed the plausibility check
 *                 (future dates etc). Off by default — see isPlausibleDob.
 *   --no-relink   Create the auth account and update profiles.email, but leave
 *                 profiles.id pointing at the old login (i.e. don't actually
 *                 hand them the new sign-in).
 *
 * Creating an auth user here uses admin.createUser({email_confirm:true}), which
 * does NOT send mail — nobody gets an unexpected email from running this.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const supabase = require("../config/config").supabase;

const APPLY = process.argv.includes("--apply");
const FORCE_DOB = process.argv.includes("--force-dob");
const RELINK_AUTH = !process.argv.includes("--no-relink");

/**
 * Requests whose email must be left alone. Keyed by portal_id rather than name
 * so a rename can't accidentally widen the exemption.
 *   8001 = Mark Thabet — keep his existing markthabet122@gmail.com.
 */
const KEEP_EXISTING_EMAIL = new Set(["8001"]);

/**
 * Birthdays to leave alone. These submitted dates are valid on their own but are
 * the directory's month and day transposed, so they were judged to be form typos
 * rather than corrections.
 *   8001  = Mark Thabet  — directory 2011-11-05 vs submitted 2011-05-11
 *   88435 = Beshoy Fathy — directory 2021-08-01 vs submitted 2021-01-08
 */
const KEEP_EXISTING_DOB = new Set(["8001", "88435"]);

/**
 * Hand-corrected addresses, applied before validation. Explicit per portal_id so
 * a real person's address is never silently guessed at scale.
 *   17285 = Felobateer Samear — submitted "@yahoo.con", confirmed as "@yahoo.com".
 */
const EMAIL_OVERRIDES = new Map([["17285", "neveenyoussif@yahoo.com"]]);

const norm = (v) => (v === null || v === undefined ? "" : String(v).trim());
const sameText = (a, b) => norm(a) === norm(b);
const sameEmail = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

/** Conservative RFC-ish check; mainly catches the ".con" style typos. */
function isValidEmail(email) {
  const e = norm(email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)) return false;
  // Common TLD typos that would silently create an unreachable account.
  if (/\.(con|cmo|comm|ocm|nte|met)$/.test(e)) return false;
  return true;
}

/**
 * A birthday is only accepted if it could belong to a real student: in the past,
 * and between 2 and 100 years old. This is what rejects the 2026 dates.
 */
function isPlausibleDob(dob) {
  const d = norm(dob);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const when = new Date(d + "T00:00:00Z");
  if (Number.isNaN(when.getTime())) return false;
  const now = new Date();
  if (when > now) return false;
  const years = (now - when) / (365.25 * 24 * 3600 * 1000);
  return years >= 2 && years <= 100;
}

/** Flags the month/day-swap pattern so a human can eyeball it. */
function looksLikeMonthDaySwap(oldDob, newDob) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(norm(oldDob));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(norm(newDob));
  if (!a || !b) return false;
  return a[1] === b[1] && a[2] === b[3] && a[3] === b[2] && a[2] !== a[3];
}

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error("listUsers failed: " + error.message);
    if (!data || !data.users.length) break;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function main() {
  console.log(
    APPLY
      ? "*** APPLY MODE — changes WILL be written ***"
      : "DRY RUN — nothing will be modified (pass --apply to write)",
  );
  console.log(`flags: force-dob=${FORCE_DOB} relink=${RELINK_AUTH}\n`);

  const { data: requests, error: reqErr } = await supabase
    .from("ds_registration_requests")
    .select("*")
    .eq("status", "linked")
    .order("reviewed_at", { ascending: true });
  if (reqErr) throw new Error("could not load requests: " + reqErr.message);

  const authUsers = await listAllAuthUsers();
  const authByEmail = new Map(
    authUsers.map((u) => [norm(u.email).toLowerCase(), u]),
  );

  // How many profile rows share each auth id — used to warn before repointing.
  const { data: allProfiles } = await supabase
    .from("profiles")
    .select("id")
    .range(0, 4999);
  const profilesPerAuthId = new Map();
  (allProfiles || []).forEach((p) => {
    profilesPerAuthId.set(p.id, (profilesPerAuthId.get(p.id) || 0) + 1);
  });

  const backup = [];
  const report = {
    updated: 0,
    unchanged: 0,
    missingProfile: 0,
    dobSkipped: [],
    dobSwapWarning: [],
    emailSkippedInvalid: [],
    emailKeptByRule: [],
    authCreated: [],
    authReused: [],
    relinked: [],
    errors: [],
  };

  for (const req of requests) {
    const who = `${norm(req.first_name)} ${norm(req.last_name)}`.trim();
    const portalId = norm(req.linked_portal_id);
    if (!portalId) {
      report.errors.push(`${who}: linked but has no linked_portal_id`);
      continue;
    }

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("portal_id", portalId)
      .maybeSingle();
    if (profErr) {
      report.errors.push(`${who} (${portalId}): ${profErr.message}`);
      continue;
    }
    if (!profile) {
      report.missingProfile++;
      report.errors.push(`${who} (${portalId}): no profile with that portal_id`);
      continue;
    }

    backup.push({
      portal_id: profile.portal_id,
      id: profile.id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      cellphone: profile.cellphone,
      dob: profile.dob,
      email: profile.email,
    });

    const updates = {};
    const notes = [];

    // ── Name ────────────────────────────────────────────────────────────────
    if (norm(req.first_name) && !sameText(profile.first_name, req.first_name)) {
      updates.first_name = norm(req.first_name);
      notes.push(`first_name "${norm(profile.first_name)}" -> "${updates.first_name}"`);
    }
    if (norm(req.last_name) && !sameText(profile.last_name, req.last_name)) {
      updates.last_name = norm(req.last_name);
      notes.push(`last_name "${norm(profile.last_name)}" -> "${updates.last_name}"`);
    }

    // ── Phone ───────────────────────────────────────────────────────────────
    if (norm(req.cellphone) && !sameText(profile.cellphone, req.cellphone)) {
      updates.cellphone = norm(req.cellphone);
      notes.push(`cellphone "${norm(profile.cellphone)}" -> "${updates.cellphone}"`);
    }

    // ── Birthday ────────────────────────────────────────────────────────────
    if (norm(req.dob) && !sameText(profile.dob, req.dob)) {
      const plausible = isPlausibleDob(req.dob);
      if (KEEP_EXISTING_DOB.has(portalId)) {
        report.dobSkipped.push(
          `${who} (${portalId}): kept ${norm(profile.dob)}, ignored ${norm(req.dob)} (suspected month/day typo)`,
        );
      } else if (plausible || FORCE_DOB) {
        updates.dob = norm(req.dob);
        notes.push(`dob ${norm(profile.dob)} -> ${updates.dob}`);
        if (looksLikeMonthDaySwap(profile.dob, req.dob)) {
          report.dobSwapWarning.push(
            `${who} (${portalId}): ${norm(profile.dob)} -> ${norm(req.dob)} (month/day swapped — verify)`,
          );
        }
      } else {
        report.dobSkipped.push(
          `${who} (${portalId}): kept ${norm(profile.dob)}, rejected ${norm(req.dob)} (implausible)`,
        );
      }
    }

    // ── Email + auth account ────────────────────────────────────────────────
    let newAuthUserId = null;
    const submittedEmail = EMAIL_OVERRIDES.get(portalId) || norm(req.email);
    if (EMAIL_OVERRIDES.has(portalId) && !sameEmail(submittedEmail, req.email)) {
      notes.push(
        `submitted "${norm(req.email)}" corrected to "${submittedEmail}"`,
      );
    }
    const wantsEmailChange =
      norm(submittedEmail) && !sameEmail(profile.email, submittedEmail);

    if (wantsEmailChange && KEEP_EXISTING_EMAIL.has(portalId)) {
      report.emailKeptByRule.push(
        `${who} (${portalId}): kept ${norm(profile.email)}, ignored ${norm(req.email)}`,
      );
    } else if (wantsEmailChange && !isValidEmail(submittedEmail)) {
      report.emailSkippedInvalid.push(
        `${who} (${portalId}): "${norm(submittedEmail)}" is not a valid address`,
      );
    } else if (wantsEmailChange) {
      const email = norm(submittedEmail).toLowerCase();
      updates.email = email;
      notes.push(`email "${norm(profile.email)}" -> "${email}"`);

      const existing = authByEmail.get(email);
      if (existing) {
        newAuthUserId = existing.id;
        report.authReused.push(`${who} (${portalId}): ${email} (already an account)`);
      } else if (APPLY) {
        const { data: created, error: createErr } =
          await supabase.auth.admin.createUser({
            email,
            email_confirm: true, // no invitation mail is sent
            user_metadata: {
              first_name: updates.first_name || profile.first_name,
              last_name: updates.last_name || profile.last_name,
              portal_id: profile.portal_id,
            },
          });
        if (createErr) {
          report.errors.push(`${who} (${portalId}): createUser — ${createErr.message}`);
        } else {
          newAuthUserId = created.user.id;
          authByEmail.set(email, created.user);
          report.authCreated.push(`${who} (${portalId}): ${email}`);
        }
      } else {
        report.authCreated.push(`${who} (${portalId}): ${email} (would create)`);
      }

      // Point this person at the new login. profiles.id is a per-family login
      // pointer, so this is what actually lets them sign in with the new email;
      // any siblings not covered by a linked request keep the old account, which
      // is left intact either way.
      if (newAuthUserId && newAuthUserId !== profile.id) {
        const shared = profilesPerAuthId.get(profile.id) || 1;
        if (RELINK_AUTH) {
          updates.id = newAuthUserId;
          report.relinked.push(
            `${who} (${portalId}): login -> ${email}` +
              (shared > 1
                ? `  (old login also served ${shared - 1} other profile(s), left as-is)`
                : ""),
          );
        } else {
          notes.push(`auth account ready; profiles.id left as-is (--no-relink)`);
        }
      }
    }

    // ── Write ───────────────────────────────────────────────────────────────
    const changedFields = Object.keys(updates);
    if (!changedFields.length) {
      report.unchanged++;
      console.log(`— ${who} (${portalId}): nothing to change`);
      continue;
    }

    console.log(`${APPLY ? "UPDATE" : "would update"} ${who} (${portalId})`);
    notes.forEach((n) => console.log(`     ${n}`));

    if (APPLY) {
      const { error: updErr } = await supabase
        .from("profiles")
        .update(updates)
        .eq("portal_id", portalId);
      if (updErr) {
        report.errors.push(`${who} (${portalId}): update — ${updErr.message}`);
        continue;
      }
    }
    report.updated++;
  }

  // A snapshot of every touched row as it looked BEFORE the run, so the change
  // can be reversed by hand if something turns out wrong.
  if (APPLY && backup.length) {
    const dir = path.join(__dirname, "backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(
      dir,
      `profiles-before-sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`\nbackup of previous values: ${file}`);
  }

  const section = (title, rows) => {
    if (!rows.length) return;
    console.log(`\n${title} (${rows.length}):`);
    rows.forEach((r) => console.log(`  - ${r}`));
  };

  console.log("\n──────── summary ────────");
  console.log(`requests processed : ${requests.length}`);
  console.log(`profiles ${APPLY ? "updated" : "to update"}  : ${report.updated}`);
  console.log(`already current    : ${report.unchanged}`);
  section("birthdays REJECTED as implausible (use --force-dob to apply)", report.dobSkipped);
  section("birthdays applied but month/day swapped — VERIFY", report.dobSwapWarning);
  section("emails skipped, invalid address", report.emailSkippedInvalid);
  section("emails kept by rule", report.emailKeptByRule);
  section(`auth accounts ${APPLY ? "created" : "that would be created"}`, report.authCreated);
  section("auth accounts reused (already existed)", report.authReused);
  section(`sign-in ${APPLY ? "repointed" : "to repoint"} to the new email`, report.relinked);
  section("ERRORS", report.errors);

  if (!APPLY) console.log("\nDry run only. Re-run with --apply to write.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
