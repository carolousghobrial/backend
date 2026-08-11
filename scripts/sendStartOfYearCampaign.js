/**
 * Email everyone currently enrolled in Deacons School (the open academic
 * year, across all courses) to let them know classes start this week.
 * Includes a magic sign-in link for the parent portal and a direct link to
 * their specific class's schedule.
 *
 * Audience: active enrollments in the open (not-closed) academic year. One
 * email per enrolled student, same as sendReenrollmentCampaign.js — a family
 * with multiple kids in different classes gets one email per child, each
 * with that child's own class link.
 *
 * Usage:
 *   node scripts/sendStartOfYearCampaign.js                    # dry run (default)
 *   node scripts/sendStartOfYearCampaign.js --sample=you@x.com # send ONE real
 *                                                                 render to a test inbox
 *   node scripts/sendStartOfYearCampaign.js --apply            # send to the real audience
 *   node scripts/sendStartOfYearCampaign.js --apply --resend   # ignore the "already sent" log
 *
 * Safety:
 *   - Dry run by default; --apply is required to send anything for real.
 *   - Every portal_id that gets a real send is logged to
 *     scripts/logs/start-of-year-campaign-sent.json. Re-running with --apply
 *     skips anyone already in that log, so re-running after a partial
 *     failure doesn't double-email people. --resend overrides this.
 *   - Links point at the PRODUCTION site (https://www.stgeorgecocnashville.org),
 *     never localhost — this script's output goes to real inboxes.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const supabase = require("../config/config").supabase;
const { renderStartOfYearEmail } = require("./templates/startOfYearEmail");

const APPLY = process.argv.includes("--apply");
const RESEND_IGNORE_LOG = process.argv.includes("--resend");
const SAMPLE_ARG = process.argv.find((a) => a.startsWith("--sample="));
const SAMPLE_EMAIL = SAMPLE_ARG ? SAMPLE_ARG.split("=")[1] : null;

const PROD_SITE = "https://www.stgeorgecocnashville.org";
const SIGN_IN_REDIRECT_TO = `${PROD_SITE}/auth/callback`;
const FROM = "St. George Deacons School <noreply@stgeorgecocnashville.org>";
const REPLY_TO = "st.georgedeaconschool@gmail.com";
const EDGE_FUNCTION_URL =
  "https://oplzcugljytvywvewdkj.supabase.co/functions/v1/send-campaign-email";
const SEND_BATCH_SIZE = 40; // per edge-function call; function itself chunks Resend at 100

const LOG_PATH = path.join(__dirname, "logs", "start-of-year-campaign-sent.json");

function loadSentLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveSentLog(log) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

/** The currently open (not-yet-closed) academic year — same rule used by
 * register-members / registration-requests, not is_current (which flips
 * meaning at year-end rollover). */
async function resolveOpenYear() {
  const { data: years, error } = await supabase
    .from("ds_academic_years")
    .select("year_label, is_closed")
    .order("year_label", { ascending: false });
  if (error) throw new Error("could not load academic years: " + error.message);
  const open = years
    .filter((y) => !y.is_closed)
    .sort((a, b) => b.year_label.localeCompare(a.year_label))[0];
  if (!open) throw new Error("no open academic year found");
  return open.year_label;
}

async function buildAudience(academicYear) {
  const { data: enrollments, error: enrollErr } = await supabase
    .from("ds_student_enrollment")
    .select(`student_id, course_id, ds_courses:course_id (course_id, class_name)`)
    .eq("academic_year", academicYear)
    .eq("is_active", true);
  if (enrollErr) throw new Error(enrollErr.message);

  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("portal_id, first_name, last_name, email")
    .in("portal_id", studentIds);
  if (profErr) throw new Error(profErr.message);

  const profileMap = Object.fromEntries(profiles.map((p) => [p.portal_id, p]));

  const audience = [];
  const skipped = { noEmail: 0, noCourse: 0 };

  for (const e of enrollments) {
    const profile = profileMap[e.student_id];
    if (!profile?.email) {
      skipped.noEmail++;
      continue;
    }
    if (!e.ds_courses) {
      skipped.noCourse++;
      continue;
    }
    audience.push({
      portal_id: e.student_id,
      first_name: profile.first_name || "",
      last_name: profile.last_name || "",
      email: profile.email,
      class_name: e.ds_courses.class_name,
      course_id: e.ds_courses.course_id,
    });
  }

  return { audience, skipped };
}

async function generateMagicLink(email) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: SIGN_IN_REDIRECT_TO },
  });
  if (error) throw new Error(`generateLink(${email}) failed: ${error.message}`);
  return data.properties.action_link;
}

async function sendBatch(emails) {
  const res = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, replyTo: REPLY_TO, emails }),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

function renderFor(a, academicYear, magicLink) {
  const calendarLink = `${PROD_SITE}/deaconsSchool/calendar/${a.course_id}`;
  return renderStartOfYearEmail({
    firstName: a.first_name,
    className: a.class_name,
    academicYear,
    magicLink,
    calendarLink,
  });
}

async function main() {
  console.log(
    APPLY ? "*** APPLY MODE — real emails WILL be sent ***" : "DRY RUN — nothing will be sent",
  );

  const academicYear = await resolveOpenYear();
  const { audience, skipped } = await buildAudience(academicYear);
  console.log(`academic year: ${academicYear}`);
  console.log(`audience: ${audience.length}`);
  console.log("skipped:", skipped);

  // ── Single test send, doesn't touch the log or the real audience ──────────
  if (SAMPLE_EMAIL) {
    const sample = audience[0];
    if (!sample) throw new Error("no audience to build a sample from");
    const magicLink = await generateMagicLink(sample.email);
    const rendered = renderFor(sample, academicYear, magicLink);
    console.log(`\nSending a REAL sample render (based on ${sample.first_name} ${sample.last_name}'s actual data) to ${SAMPLE_EMAIL}...`);
    console.log("NOTE: the magic link inside is real but signed for", sample.email, "— do not click it, it would sign in as that family.");
    const result = await sendBatch([{ to: SAMPLE_EMAIL, subject: rendered.subject, html: rendered.html, text: rendered.text }]);
    console.log(result.ok ? "Sent." : "FAILED:", JSON.stringify(result.body));
    return;
  }

  const sentLog = loadSentLog();
  const toSend = RESEND_IGNORE_LOG
    ? audience
    : audience.filter((a) => !sentLog[a.portal_id]);
  const alreadyLogged = audience.length - toSend.length;
  if (alreadyLogged) {
    console.log(`${alreadyLogged} already logged as sent — skipping (use --resend to override).`);
  }

  if (!APPLY) {
    console.log(`\nWould send ${toSend.length} emails. Sample recipients:`);
    toSend.slice(0, 10).forEach((a) =>
      console.log(`  - ${a.first_name} ${a.last_name} <${a.email}> | ${a.class_name}`),
    );
    console.log("\nDry run only. Re-run with --apply to send for real.");
    return;
  }

  console.log(`\nSending to ${toSend.length} recipients in batches of ${SEND_BATCH_SIZE}...`);
  let sentCount = 0;
  let failCount = 0;

  for (let i = 0; i < toSend.length; i += SEND_BATCH_SIZE) {
    const batch = toSend.slice(i, i + SEND_BATCH_SIZE);
    const rendered = [];
    for (const a of batch) {
      try {
        const magicLink = await generateMagicLink(a.email);
        const r = renderFor(a, academicYear, magicLink);
        rendered.push({ portal_id: a.portal_id, to: a.email, subject: r.subject, html: r.html, text: r.text });
      } catch (err) {
        console.error(`  generateLink failed for ${a.email}:`, err.message);
        failCount++;
      }
    }
    if (!rendered.length) continue;

    const result = await sendBatch(rendered.map(({ portal_id, ...e }) => e));
    if (result.ok) {
      rendered.forEach((r) => {
        sentLog[r.portal_id] = { email: r.to, sent_at: new Date().toISOString() };
      });
      saveSentLog(sentLog);
      sentCount += rendered.length;
      console.log(`  batch ${Math.floor(i / SEND_BATCH_SIZE) + 1}: sent ${rendered.length}`);
    } else {
      failCount += rendered.length;
      console.error(`  batch ${Math.floor(i / SEND_BATCH_SIZE) + 1} FAILED:`, JSON.stringify(result.body));
    }
  }

  console.log(`\nDone. sent=${sentCount} failed=${failCount}`);
  console.log(`Sent-log: ${LOG_PATH}`);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
