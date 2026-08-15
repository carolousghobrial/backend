/**
 * General backfill for the whole class of bug found via Mary Hanna: a
 * portal_id reference (teacher_id, student_id, etc.) picked up a stray
 * leading/trailing whitespace or newline character somewhere along the way
 * (bulk import, copy/paste), so it no longer string-matches the real,
 * logged-in profile's clean portal_id -- silently breaking role/assignment
 * lookups for that person with no visible error.
 *
 * For every configured {table, column} pair, this scans for values that
 * don't match their own trimmed form, resolves each to the clean profile
 * portal_id, and:
 *   - if a row already exists for the same "logical slot" (the dedupeKeys)
 *     with the clean id, DELETES the dirty row (it's a redundant duplicate)
 *   - otherwise UPDATES the dirty row's column to the clean id
 *   - if the trimmed value doesn't match ANY real profile, it's flagged for
 *     manual review and left untouched (should not happen, but don't guess)
 *
 * Does NOT touch profiles.portal_id itself. If a dirty value happens to
 * match an existing corrupted *duplicate* profile (same situation as Mary
 * Hanna's "6436\n" second profile with its own email/login), that's a
 * separate merge-two-accounts decision for a human -- this script only
 * reports it.
 *
 * Usage:
 *   node scripts/backfillPortalIdWhitespace.js            # dry run (default)
 *   node scripts/backfillPortalIdWhitespace.js --apply     # write changes
 */

require("dotenv").config();
const supabase = require("../config/config").supabase;

const APPLY = process.argv.includes("--apply");

const isDirty = (v) => typeof v === "string" && v !== v.trim() && v.trim() !== "";

// Supabase/PostgREST caps rows-per-request at 1000 regardless of the range()
// bounds requested, so a single .range(0, N) call silently truncates on any
// table bigger than that (ds_attendance alone has 5000+ rows) -- page through
// in batches of 1000 until a short page confirms we've hit the end.
const PAGE_SIZE = 1000;
async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

// dedupeKeys = other columns that, together with the (fixed) portal_id
// column, define this table's logical uniqueness -- null means the row is
// already uniquely identified some other way (its own primary key alone),
// so just update in place, never delete.
const TARGETS = [
  { table: "ds_course_teachers", column: "teacher_id", pk: "course_teacher_id", dedupeKeys: ["course_id"] },
  { table: "ds_student_enrollment", column: "student_id", pk: "enrollment_id", dedupeKeys: ["course_id", "academic_year"] },
  { table: "ds_calendar_teacher_assignments", column: "hymn_teacher_id", pk: "id", dedupeKeys: null },
  { table: "ds_calendar_teacher_assignments", column: "other_teacher_id", pk: "id", dedupeKeys: null },
  { table: "user_service_roles", column: "portal_id", pk: "id", dedupeKeys: ["role_id", "service_id"] },
  { table: "ds_teacher_attendance", column: "teacher_id", pk: "attendance_id", dedupeKeys: ["session_id"] },
  { table: "ds_attendance", column: "student_id", pk: "attendance_id", dedupeKeys: ["session_id"] },
  { table: "ds_registration_requests", column: "linked_portal_id", pk: "id", dedupeKeys: null },
  { table: "ds_student_final_grades", column: "student_id", pk: "grade_id", dedupeKeys: ["course_id", "academic_year"] },
];

async function main() {
  console.log(
    APPLY
      ? "*** APPLY MODE — changes WILL be written ***"
      : "DRY RUN — nothing will be modified (pass --apply to write)",
  );

  const { data: profiles, error: profError } = await fetchAll("profiles", "portal_id, first_name, last_name");
  if (profError) throw new Error("could not load profiles: " + profError.message);

  const cleanProfileIds = new Set(profiles.map((p) => p.portal_id));
  const dirtyProfiles = profiles.filter((p) => isDirty(p.portal_id));
  if (dirtyProfiles.length) {
    console.log(`\nprofiles.portal_id itself has ${dirtyProfiles.length} corrupted row(s) — NOT auto-fixed, needs human review:`);
    dirtyProfiles.forEach((p) =>
      console.log(`  - ${JSON.stringify(p.portal_id)} (${p.first_name} ${p.last_name}) — likely a duplicate of the clean profile with its own auth login`),
    );
  }

  const summary = { updated: 0, deleted: 0, unresolved: 0, skippedTables: [] };

  for (const { table, column, pk, dedupeKeys } of TARGETS) {
    const selectCols = [pk, column, ...(dedupeKeys || [])].join(", ");
    const { data: rows, error } = await fetchAll(table, selectCols);
    if (error) {
      console.log(`\n${table}.${column}: SKIPPED (${error.message})`);
      summary.skippedTables.push(`${table}.${column}`);
      continue;
    }

    const dirtyRows = (rows || []).filter((r) => isDirty(r[column]));
    if (!dirtyRows.length) continue;

    console.log(`\n${table}.${column}: ${dirtyRows.length} dirty row(s)`);
    for (const row of dirtyRows) {
      const dirtyValue = row[column];
      const cleanValue = dirtyValue.trim();

      if (!cleanProfileIds.has(cleanValue)) {
        console.log(`  UNRESOLVED ${JSON.stringify(dirtyValue)} — trimmed value "${cleanValue}" matches no profile, left as-is`);
        summary.unresolved++;
        continue;
      }

      let isDuplicate = false;
      if (dedupeKeys) {
        let dupQuery = supabase.from(table).select(pk).eq(column, cleanValue);
        for (const key of dedupeKeys) dupQuery = dupQuery.eq(key, row[key]);
        const { data: dupRows, error: dupErr } = await dupQuery;
        if (dupErr) {
          console.log(`  ERROR checking duplicate for ${pk}=${row[pk]}: ${dupErr.message}`);
          continue;
        }
        isDuplicate = (dupRows || []).length > 0;
      }

      if (isDuplicate) {
        console.log(`  ${APPLY ? "DELETE" : "would delete"} ${table}.${pk}=${row[pk]} (${JSON.stringify(dirtyValue)} — clean "${cleanValue}" row already covers this)`);
        if (APPLY) {
          const { error: delErr } = await supabase.from(table).delete().eq(pk, row[pk]);
          if (delErr) console.log(`    delete error: ${delErr.message}`);
          else summary.deleted++;
        }
      } else {
        console.log(`  ${APPLY ? "UPDATE" : "would update"} ${table}.${pk}=${row[pk]}: ${JSON.stringify(dirtyValue)} -> "${cleanValue}"`);
        if (APPLY) {
          const { error: updErr } = await supabase.from(table).update({ [column]: cleanValue }).eq(pk, row[pk]);
          if (updErr) console.log(`    update error: ${updErr.message}`);
          else summary.updated++;
        }
      }
    }
  }

  console.log("\n──────── summary ────────");
  console.log(`rows ${APPLY ? "updated" : "to update"}: ${summary.updated}`);
  console.log(`rows ${APPLY ? "deleted" : "to delete"}: ${summary.deleted}`);
  console.log(`unresolved (no matching profile): ${summary.unresolved}`);
  if (summary.skippedTables.length) console.log(`skipped (query error): ${summary.skippedTables.join(", ")}`);
  if (!APPLY) console.log("\nDry run only. Re-run with --apply to write.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
