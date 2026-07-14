/**
 * Deacons School promotion rules — shared between the (manual, dry-run)
 * year-end promotion report and the live self-registration form's
 * "suggested next class" preselect.
 *
 * Course level codes for the combined-grade classes (5th & 6th, 7th & 8th)
 * are NOT guaranteed to stay the same code across academic years — e.g.
 * 2025-2026 used ds_level_6 / ds_level_8 for them, while 2026-2027 used
 * ds_level_5 / ds_level_7 instead. So those two brackets are identified by
 * class_name pattern ("5th" + "6th" / "7th" + "8th"), not by level code.
 * The single-grade levels (alpha, beta, 1-4, 9, 10, graduates) use stable
 * level codes across years and are matched directly.
 */

// Alpha and Beta always advance, regardless of pass/fail.
const ALWAYS_ADVANCE_NEXT = {
  ds_level_alpha: "ds_level_beta",
  ds_level_beta: "ds_level_1",
};

// Levels 1-3 advance only if the student passed; otherwise they repeat.
const PASS_GATED_NEXT = {
  ds_level_1: "ds_level_2",
  ds_level_2: "ds_level_3",
  ds_level_3: "ds_level_4",
};

const SINGLE_LEVEL_NEXT = { ...ALWAYS_ADVANCE_NEXT, ...PASS_GATED_NEXT };

function genderFromClassName(className) {
  const c = (className || "").toLowerCase();
  if (c.includes("boys")) return "male";
  if (c.includes("girls")) return "female";
  return "";
}

// Classifies a course into a stable "bracket" key independent of the
// level enum's exact string from year to year.
function classifyCourse(course) {
  const name = (course.class_name || "").toLowerCase();
  const hasFive = /\b5th\b/.test(name);
  const hasSix = /\b6th\b/.test(name);
  const hasSeven = /\b7th\b/.test(name);
  const hasEight = /\b8th\b/.test(name);

  if (hasFive && hasSix) return "bracket_5_6";
  if (hasSeven && hasEight) return "bracket_7_8";

  if (course.level === "ds_level_graduates" || name.includes("graduate")) {
    return "graduates";
  }
  if (SINGLE_LEVEL_NEXT[course.level]) return course.level;
  if (course.level === "ds_level_9") return "ds_level_9";
  if (course.level === "ds_level_10") return "ds_level_10";
  if (course.level === "ds_level_4") return "ds_level_4";

  return "unknown";
}

/**
 * @param {object} params
 * @param {string} params.bracket - result of classifyCourse() on the student's current course
 * @param {string} params.gender - 'male' | 'female' | ''
 * @param {string} params.gradeLevel - profile.grade_level, e.g. "6th Grade"
 * @param {boolean} params.passed - is_passing_year for the current course
 * @returns {null | { bracket: string, gender?: string, newGradeLevel?: string }}
 *   null means excluded (graduated). bracket is either a stable level code
 *   ("ds_level_2", "ds_level_9", ...) or "bracket_5_6" / "bracket_7_8".
 */
function decideNextBracket({ bracket, gender, gradeLevel, passed }) {
  if (ALWAYS_ADVANCE_NEXT[bracket]) {
    return { bracket: ALWAYS_ADVANCE_NEXT[bracket] };
  }
  if (PASS_GATED_NEXT[bracket]) {
    return passed ? { bracket: PASS_GATED_NEXT[bracket] } : { bracket };
  }

  switch (bracket) {
    case "ds_level_4":
      return passed ? { bracket: "bracket_5_6", gender } : { bracket };
    case "bracket_5_6":
      if (!passed) return { bracket, gender };
      if (gradeLevel === "6th Grade") {
        return { bracket: "bracket_7_8", gender, newGradeLevel: "7th Grade" };
      }
      return { bracket, gender, newGradeLevel: "6th Grade" };
    case "bracket_7_8":
      if (!passed) return { bracket, gender };
      if (gradeLevel === "8th Grade") {
        return { bracket: "ds_level_9", newGradeLevel: "9th Grade" };
      }
      return { bracket, gender, newGradeLevel: "8th Grade" };
    case "ds_level_9":
      return passed ? { bracket: "ds_level_10" } : { bracket };
    case "ds_level_10":
      return passed ? { bracket: "graduates" } : { bracket };
    case "graduates":
      return null; // excluded — no further class
    default:
      return null; // unknown bracket — caller should treat as "no suggestion"
  }
}

// Finds the matching course in `courses` (already filtered to one academic
// year) for a given decideNextBracket() result.
function resolveCourse(courses, decision) {
  if (!decision) return null;
  const candidates = courses.filter(
    (c) => classifyCourse(c) === decision.bracket,
  );
  if (candidates.length <= 1) return candidates[0] || null;
  if (!decision.gender) return candidates[0] || null;
  return (
    candidates.find((c) => genderFromClassName(c.class_name) === decision.gender) ||
    null
  );
}

module.exports = {
  classifyCourse,
  genderFromClassName,
  decideNextBracket,
  resolveCourse,
};
