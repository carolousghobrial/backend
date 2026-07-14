/**
 * Deacons School Year-End Promotion — REPORT ONLY.
 *
 * Reads every active student enrollment for OLD_YEAR and prints which class
 * each student is headed into for NEW_YEAR, using the same rules the live
 * self-registration form uses to preselect a "Suggested" class
 * (backend/utils/promotionRules.js). This script does NOT write anything —
 * students enroll themselves through the registration form; this is purely
 * a sanity-check report so you can verify the rules before students start
 * registering.
 *
 * Run:
 *   node scripts/promoteNewYear.js
 */

const supabase = require("../config/config").supabase;
const {
  classifyCourse,
  decideNextBracket,
  resolveCourse,
} = require("../utils/promotionRules");

const OLD_YEAR = process.env.PROMOTE_OLD_YEAR || "2025-2026";
const NEW_YEAR = process.env.PROMOTE_NEW_YEAR || "2026-2027";

async function main() {
  console.log(`Deacons School promotion report: ${OLD_YEAR} -> ${NEW_YEAR}\n`);

  const { data: newCourses, error: newCoursesErr } = await supabase
    .from("ds_courses")
    .select("course_id, class_name, level")
    .eq("academic_year", NEW_YEAR);
  if (newCoursesErr) throw newCoursesErr;

  if (!newCourses.length) {
    console.error(
      `No ds_courses found for ${NEW_YEAR}. Run newYear/setupCourses first.`,
    );
    process.exit(1);
  }

  const { data: oldCourses, error: oldCoursesErr } = await supabase
    .from("ds_courses")
    .select("course_id, class_name, level")
    .eq("academic_year", OLD_YEAR);
  if (oldCoursesErr) throw oldCoursesErr;
  const oldCourseById = new Map(oldCourses.map((c) => [c.course_id, c]));

  const { data: enrollments, error: enrollErr } = await supabase
    .from("ds_student_enrollment")
    .select(
      `enrollment_id, student_id, course_id,
       profiles:student_id ( portal_id, first_name, last_name, grade_level, gender )`,
    )
    .eq("academic_year", OLD_YEAR)
    .eq("is_active", true);
  if (enrollErr) throw enrollErr;

  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  const courseIds = [...new Set(enrollments.map((e) => e.course_id))];

  const { data: finalGrades, error: gradesErr } = await supabase
    .from("ds_student_final_grades")
    .select("student_id, course_id, is_passing_year")
    .in("student_id", studentIds)
    .in("course_id", courseIds);
  if (gradesErr) throw gradesErr;

  const gradeMap = new Map(
    finalGrades.map((g) => [`${g.student_id}__${g.course_id}`, g]),
  );

  const plan = [];
  const problems = [];
  let excludedGraduates = 0;

  for (const e of enrollments) {
    const profile = e.profiles;
    const course = oldCourseById.get(e.course_id);
    const name = profile
      ? `${profile.first_name} ${profile.last_name}`
      : e.student_id;

    if (!profile) {
      problems.push({ student: e.student_id, reason: "Missing profile" });
      continue;
    }
    if (!course) {
      problems.push({
        student: name,
        reason: `Enrollment course_id ${e.course_id} not found in ${OLD_YEAR} ds_courses`,
      });
      continue;
    }

    const grade = gradeMap.get(`${e.student_id}__${e.course_id}`);
    if (!grade) {
      problems.push({
        student: name,
        reason: `No final grade found for ${course.class_name} (${OLD_YEAR}) — cannot determine pass/fail`,
      });
      continue;
    }

    const bracket = classifyCourse(course);
    if (bracket === "graduates") {
      excludedGraduates++;
      continue;
    }
    if (bracket === "unknown") {
      problems.push({
        student: name,
        reason: `Unrecognized course "${course.class_name}" (level ${course.level})`,
      });
      continue;
    }

    const decision = decideNextBracket({
      bracket,
      gender: profile.gender || "",
      gradeLevel: profile.grade_level || "",
      passed: !!grade.is_passing_year,
    });

    if (decision === null) {
      excludedGraduates++;
      continue;
    }
    if (
      (decision.bracket === "bracket_5_6" || decision.bracket === "bracket_7_8") &&
      !decision.gender
    ) {
      problems.push({
        student: name,
        reason: `No gender set on profile — cannot route into ${decision.bracket === "bracket_5_6" ? "5th & 6th" : "7th & 8th"} Boys/Girls`,
      });
      continue;
    }

    const destCourse = resolveCourse(newCourses, decision);
    if (!destCourse) {
      problems.push({
        student: name,
        reason: `No ${NEW_YEAR} course found for bracket "${decision.bracket}"${decision.gender ? ` (${decision.gender})` : ""}`,
      });
      continue;
    }

    plan.push({
      studentName: name,
      fromClass: course.class_name,
      toClass: destCourse.class_name,
      passed: !!grade.is_passing_year,
    });
  }

  console.log(`Active ${OLD_YEAR} enrollments: ${enrollments.length}`);
  console.log(`Excluded (Graduates): ${excludedGraduates}`);
  console.log(`Would be suggested: ${plan.length}`);
  console.log(`Problems (need manual review): ${problems.length}\n`);

  const byTransition = new Map();
  for (const p of plan) {
    const key = `${p.fromClass} -> ${p.toClass}`;
    byTransition.set(key, (byTransition.get(key) || 0) + 1);
  }
  console.log("Transitions:");
  for (const [key, count] of [...byTransition.entries()].sort()) {
    console.log(`  ${count.toString().padStart(4)}  ${key}`);
  }

  if (problems.length) {
    console.log("\nProblems:");
    for (const p of problems) {
      console.log(`  - ${p.student}: ${p.reason}`);
    }
  }

  console.log(
    "\nThis is a report only — nothing was written. Students see their suggested class on the registration form and enroll themselves.",
  );
}

main().catch((err) => {
  console.error("\nPromotion report failed:", err.message || err);
  process.exit(1);
});
