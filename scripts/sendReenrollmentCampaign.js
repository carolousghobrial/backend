/**
 * Email last year's Deacons School members who have NOT yet registered for
 * the new year, inviting them to sign in (magic link) and register.
 *
 * Audience: active enrollments in the latest CLOSED academic year, minus
 * anyone with an active enrollment in the next year already, minus anyone
 * whose promotion resolves to "graduated" (no next class — different
 * conversation entirely). Reuses the same promotionRules logic as the rest
 * of the app (classifyCourse / decideNextBracket / resolveCourse), not a
 * reimplementation.
 *
 * Usage:
 *   node scripts/sendReenrollmentCampaign.js                 # dry run (default)
 *   node scripts/sendReenrollmentCampaign.js --sample=you@x.com   # send ONE real
 *                                                                   render to a test inbox
 *   node scripts/sendReenrollmentCampaign.js --apply          # send to the real audience
 *   node scripts/sendReenrollmentCampaign.js --apply --resend # ignore the "already sent" log
 *
 * Safety:
 *   - Dry run by default; --apply is required to send anything for real.
 *   - Every portal_id that gets a real send is logged to
 *     scripts/logs/reenrollment-campaign-sent.json. Re-running with --apply
 *     skips anyone already in that log, so re-running after a partial
 *     failure doesn't double-email people. --resend overrides this.
 *   - Magic links point at the PRODUCTION site
 *     (https://www.stgeorgecocnashville.org/deaconsSchoolRegister?claim=1),
 *     never localhost — this script's output goes to real inboxes.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const supabase = require("../config/config").supabase;
const {
  classifyCourse,
  decideNextBracket,
  resolveCourse,
} = require("../utils/promotionRules");
const { renderReenrollmentEmail } = require("./templates/reenrollmentEmail");

const APPLY = process.argv.includes("--apply");
const RESEND_IGNORE_LOG = process.argv.includes("--resend");
const SAMPLE_ARG = process.argv.find((a) => a.startsWith("--sample="));
const SAMPLE_EMAIL = SAMPLE_ARG ? SAMPLE_ARG.split("=")[1] : null;

const PROD_SITE = "https://www.stgeorgecocnashville.org";
const REDIRECT_TO = `${PROD_SITE}/deaconsSchoolRegister?claim=1`;
const FROM = "St. George Deacons School <noreply@stgeorgecocnashville.org>";
const REPLY_TO = "st.georgedeaconschool@gmail.com";
const EDGE_FUNCTION_URL =
  "https://oplzcugljytvywvewdkj.supabase.co/functions/v1/send-campaign-email";
const SEND_BATCH_SIZE = 40; // per edge-function call; function itself chunks Resend at 100

const LOG_PATH = path.join(__dirname, "logs", "reenrollment-campaign-sent.json");

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

/** Same "which year is actually last year" logic used by register-members. */
async function resolveSourceYear() {
  const { data: years, error } = await supabase
    .from("ds_academic_years")
    .select("year_label, is_closed")
    .order("year_label", { ascending: false });
  if (error) throw new Error("could not load academic years: " + error.message);
  const closed = years.filter((y) => y.is_closed);
  if (!closed.length) throw new Error("no closed academic year found");
  return closed[0].year_label;
}

/** Mirrors GET /registration/lastYearRoster/:academicYear (deaconsSchool.js). */
async function buildAudience(sourceYear) {
  const { data: enrollments, error: enrollErr } = await supabase
    .from("ds_student_enrollment")
    .select(`student_id, course_id, ds_courses:course_id (course_id, class_name, level)`)
    .eq("academic_year", sourceYear)
    .eq("is_active", true);
  if (enrollErr) throw new Error(enrollErr.message);

  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  const [{ data: profiles }, { data: finalGrades, error: gradesErr }, { data: allYears }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("portal_id, first_name, last_name, email, gender, grade_level")
        .in("portal_id", studentIds),
      supabase
        .from("ds_student_final_grades")
        .select("student_id, course_id, weighted_percentage, is_passing_year")
        .eq("academic_year", sourceYear),
      supabase.from("ds_academic_years").select("year_label"),
    ]);
  if (gradesErr) throw new Error("grades query failed: " + gradesErr.message);

  const upcomingYear =
    allYears.map((y) => y.year_label).filter((l) => l > sourceYear).sort()[0] || null;
  if (!upcomingYear) throw new Error("no upcoming academic year is set up");

  const [{ data: upcomingCourses }, { data: upcomingEnrollments }] = await Promise.all([
    supabase
      .from("ds_courses")
      .select("course_id, class_name, level, academic_year")
      .eq("academic_year", upcomingYear)
      .eq("is_active", true),
    supabase
      .from("ds_student_enrollment")
      .select("student_id, is_active")
      .eq("academic_year", upcomingYear)
      .eq("is_active", true),
  ]);

  const profileMap = Object.fromEntries(profiles.map((p) => [p.portal_id, p]));
  const gradeMap = Object.fromEntries(
    finalGrades.map((g) => [`${g.student_id}__${g.course_id}`, g]),
  );
  const alreadyRegistered = new Set(upcomingEnrollments.map((e) => e.student_id));

  const audience = [];
  const skipped = { alreadyRegistered: 0, graduated: 0, noEmail: 0, noResolvedClass: 0 };

  for (const e of enrollments) {
    if (alreadyRegistered.has(e.student_id)) {
      skipped.alreadyRegistered++;
      continue;
    }
    const profile = profileMap[e.student_id];
    if (!profile?.email) {
      skipped.noEmail++;
      continue;
    }
    const grade = gradeMap[`${e.student_id}__${e.course_id}`] || null;
    const passed = !!grade?.is_passing_year;

    const bracket = e.ds_courses ? classifyCourse(e.ds_courses) : "unknown";
    if (bracket === "graduates") {
      skipped.graduated++;
      continue;
    }
    const decision = decideNextBracket({
      bracket,
      gender: profile.gender || "",
      gradeLevel: profile.grade_level || "",
      passed,
    });
    const match = decision ? resolveCourse(upcomingCourses, decision) : null;
    if (!match) {
      skipped.noResolvedClass++;
      continue;
    }

    audience.push({
      portal_id: e.student_id,
      first_name: profile.first_name || "",
      last_name: profile.last_name || "",
      email: profile.email,
      last_year_class_name: e.ds_courses?.class_name || "",
      next_class_name: match.class_name,
      promoted: passed,
    });
  }

  return { audience, skipped, upcomingYear };
}

async function generateMagicLink(email) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: REDIRECT_TO },
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

async function main() {
  console.log(
    APPLY ? "*** APPLY MODE — real emails WILL be sent ***" : "DRY RUN — nothing will be sent",
  );

  const sourceYear = await resolveSourceYear();
  const { audience, skipped, upcomingYear } = await buildAudience(sourceYear);
  console.log(`source year (completed): ${sourceYear}`);
  console.log(`target year (registering into): ${upcomingYear}`);
  console.log(`audience: ${audience.length}`);
  console.log("skipped:", skipped);

  // ── Single test send, doesn't touch the log or the real audience ──────────
  if (SAMPLE_EMAIL) {
    const sample = audience[0];
    if (!sample) throw new Error("no audience to build a sample from");
    const magicLink = await generateMagicLink(sample.email);
    const rendered = renderReenrollmentEmail({
      firstName: sample.first_name,
      lastYearClassName: sample.last_year_class_name,
      nextClassName: sample.next_class_name,
      promoted: sample.promoted,
      upcomingYear,
      magicLink,
    });
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
      console.log(
        `  - ${a.first_name} ${a.last_name} <${a.email}> | ${a.last_year_class_name} -> ${a.promoted ? a.next_class_name : "(unnamed, repeat year)"}`,
      ),
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
        const r = renderReenrollmentEmail({
          firstName: a.first_name,
          lastYearClassName: a.last_year_class_name,
          nextClassName: a.next_class_name,
          promoted: a.promoted,
          upcomingYear,
          magicLink,
        });
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
