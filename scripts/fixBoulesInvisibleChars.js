/**
 * One-off fix for the Boules family (portal_ids 17358, 17360, 17359).
 *
 * Their registration request's first_name/last_name/email all carried a
 * leading U+200F RIGHT-TO-LEFT MARK (invisible), which syncLinkedRegistrations.js
 * wrote as-is into profiles on 2026-08-12 (see backups/profiles-before-sync-
 * 2026-08-12T13-18-14-358Z.json for pre-change values). The malformed email
 * also made Supabase reject auth-account creation for them, so they were left
 * on their old shared family login.
 *
 * This script strips invisible marks from first_name/last_name/email on those
 * 3 profiles, then creates (or reuses) an auth account for the cleaned email
 * and points all 3 profiles.id at it.
 *
 * Usage:
 *   node scripts/fixBoulesInvisibleChars.js            # dry run (default)
 *   node scripts/fixBoulesInvisibleChars.js --apply     # write changes
 */

require("dotenv").config();
const supabase = require("../config/config").supabase;

const APPLY = process.argv.includes("--apply");
const PORTAL_IDS = ["17358", "17360", "17359"];
const CLEAN_EMAIL = "ataboules@yahoo.com";

const stripInvisible = (s) =>
  (s || "").replace(/[​-‏‪-‮﻿]/g, "").trim();

async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error("listUsers failed: " + error.message);
    const found = data.users.find(
      (u) => (u.email || "").toLowerCase() === email,
    );
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function main() {
  console.log(
    APPLY
      ? "*** APPLY MODE — changes WILL be written ***"
      : "DRY RUN — nothing will be modified (pass --apply to write)",
  );

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("portal_id, id, first_name, last_name, email")
    .in("portal_id", PORTAL_IDS);
  if (error) throw new Error("could not load profiles: " + error.message);

  for (const p of profiles) {
    const updates = {
      first_name: stripInvisible(p.first_name),
      last_name: stripInvisible(p.last_name),
      email: stripInvisible(p.email).toLowerCase(),
    };
    const changed =
      updates.first_name !== p.first_name ||
      updates.last_name !== p.last_name ||
      updates.email !== p.email;
    console.log(
      `${changed ? (APPLY ? "UPDATE" : "would update") : "unchanged"} ${p.portal_id}: "${p.first_name}" / "${p.last_name}" / "${p.email}" -> "${updates.first_name}" / "${updates.last_name}" / "${updates.email}"`,
    );
    if (changed && APPLY) {
      const { error: updErr } = await supabase
        .from("profiles")
        .update(updates)
        .eq("portal_id", p.portal_id);
      if (updErr) console.error(`  update error: ${updErr.message}`);
    }
  }

  let authUser = await findAuthUserByEmail(CLEAN_EMAIL);
  if (authUser) {
    console.log(`found existing auth user ${authUser.id} for ${CLEAN_EMAIL}`);
  } else if (APPLY) {
    const { data: created, error: createErr } =
      await supabase.auth.admin.createUser({
        email: CLEAN_EMAIL,
        email_confirm: true,
        user_metadata: { portal_id: PORTAL_IDS[0] },
      });
    if (createErr) throw new Error("createUser failed: " + createErr.message);
    authUser = created.user;
    console.log(`created auth user ${authUser.id} for ${CLEAN_EMAIL}`);
  } else {
    console.log(`would create auth user for ${CLEAN_EMAIL}`);
  }

  if (authUser) {
    for (const portalId of PORTAL_IDS) {
      console.log(
        `${APPLY ? "relink" : "would relink"} ${portalId} -> auth ${authUser.id}`,
      );
      if (APPLY) {
        const { error: relinkErr } = await supabase
          .from("profiles")
          .update({ id: authUser.id })
          .eq("portal_id", portalId);
        if (relinkErr)
          console.error(`  relink error for ${portalId}: ${relinkErr.message}`);
      }
    }
  }

  if (!APPLY) console.log("\nDry run only. Re-run with --apply to write.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
