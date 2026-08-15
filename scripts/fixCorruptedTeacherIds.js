/**
 * Fixes stray whitespace/newline characters found in teacher_id values across
 * ds_course_teachers and ds_calendar_teacher_assignments. Discovered via Mary
 * Hanna (portal_id "6436") reporting "No Access Available" despite being a
 * teacher for 5th & 6th Girls: her course assignment was created against
 * "6436\n" (a corrupted duplicate profile, different email) instead of her
 * real, logged-in profile "6436" -- so the role lookup for her actual account
 * never found it.
 *
 * Two shapes of this bug exist:
 *   1. "6436\n"  -- no clean "6436" row exists for these courses, so the fix
 *      is to UPDATE teacher_id to the clean portal_id.
 *   2. "5519 " / "8411\n" -- a clean duplicate row ALREADY exists for the same
 *      teacher+course (these two didn't cause an access bug, just clutter),
 *      so the fix is to DELETE the dirty row rather than create a duplicate.
 *
 * Does NOT touch the corrupted "6436\n" profile row itself, its
 * user_service_roles, or its auth account -- that's a separate duplicate-
 * profile question (it has its own email/login) left for a human decision.
 *
 * Usage:
 *   node scripts/fixCorruptedTeacherIds.js            # dry run (default)
 *   node scripts/fixCorruptedTeacherIds.js --apply     # write changes
 */

require("dotenv").config();
const supabase = require("../config/config").supabase;

const APPLY = process.argv.includes("--apply");

// { dirty, clean, action }
const FIXES = [
  { dirty: "6436\n", clean: "6436", action: "update" }, // Mary Hanna
  { dirty: "5519 ", clean: "5519", action: "delete" },  // Maria Boshra (duplicate row)
  { dirty: "8411\n", clean: "8411", action: "delete" }, // Abanoub Hanna (duplicate row)
];

async function main() {
  console.log(
    APPLY
      ? "*** APPLY MODE — changes WILL be written ***"
      : "DRY RUN — nothing will be modified (pass --apply to write)",
  );

  for (const { dirty, clean, action } of FIXES) {
    const { data: rows, error } = await supabase
      .from("ds_course_teachers")
      .select("teacher_id, course_id, role, is_active")
      .eq("teacher_id", dirty);
    if (error) {
      console.error(`ds_course_teachers lookup for ${JSON.stringify(dirty)} failed:`, error.message);
      continue;
    }
    if (!rows.length) {
      console.log(`ds_course_teachers: no rows for ${JSON.stringify(dirty)} — nothing to do`);
    }
    for (const row of rows) {
      console.log(
        `${APPLY ? action.toUpperCase() : "would " + action} ds_course_teachers ${JSON.stringify(dirty)} -> ${clean} (course ${row.course_id})`,
      );
      if (!APPLY) continue;
      if (action === "update") {
        const { error: updErr } = await supabase
          .from("ds_course_teachers")
          .update({ teacher_id: clean })
          .eq("teacher_id", dirty)
          .eq("course_id", row.course_id);
        if (updErr) console.error("  update error:", updErr.message);
      } else {
        const { error: delErr } = await supabase
          .from("ds_course_teachers")
          .delete()
          .eq("teacher_id", dirty)
          .eq("course_id", row.course_id);
        if (delErr) console.error("  delete error:", delErr.message);
      }
    }
  }

  // ds_calendar_teacher_assignments: only the "6436\n" case appeared here.
  const { data: ctaRows, error: ctaError } = await supabase
    .from("ds_calendar_teacher_assignments")
    .select("id, calendar_id, course_id, hymn_teacher_id, other_teacher_id")
    .or("hymn_teacher_id.eq.6436\n,other_teacher_id.eq.6436\n");
  if (ctaError) {
    console.error("ds_calendar_teacher_assignments lookup failed:", ctaError.message);
  } else {
    for (const row of ctaRows) {
      const updates = {};
      if (row.hymn_teacher_id === "6436\n") updates.hymn_teacher_id = "6436";
      if (row.other_teacher_id === "6436\n") updates.other_teacher_id = "6436";
      console.log(
        `${APPLY ? "UPDATE" : "would update"} ds_calendar_teacher_assignments id=${row.id} (calendar ${row.calendar_id}, course ${row.course_id}):`,
        JSON.stringify(updates),
      );
      if (APPLY) {
        const { error: updErr } = await supabase
          .from("ds_calendar_teacher_assignments")
          .update(updates)
          .eq("id", row.id);
        if (updErr) console.error("  update error:", updErr.message);
      }
    }
  }

  if (!APPLY) console.log("\nDry run only. Re-run with --apply to write.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
