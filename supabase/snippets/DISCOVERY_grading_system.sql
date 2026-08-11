-- ================================================================
-- DISCOVERY ONLY -- READ-ONLY. Changes nothing.
-- ================================================================
-- Run this and share the output before running any grading migration.
-- The real grading math lives in Postgres functions that are NOT in
-- this repo (calculate_student_grade, get_course_students_grades,
-- get_student_all_scores, get_all_students_scores_by_course), so the
-- weights/late-policy migration cannot be written safely without
-- seeing these results first.
-- ================================================================

-- 1. Current grading categories and their weights.
--    Tells us: exact category_id/name/weight rows to change, whether
--    "attendance" and "behavior" are really two separate rows, and
--    what the altar-responses row is actually called.
SELECT category_id, category_name, weight_percentage, is_active
FROM ds_grading_categories
ORDER BY is_active DESC, weight_percentage DESC, category_name;

-- 2. Do the weights currently sum to 100 (per active set)?
SELECT
  COUNT(*) AS active_categories,
  SUM(weight_percentage) AS total_weight
FROM ds_grading_categories
WHERE is_active = true;

-- 3. Does ds_grading_categories have an academic_year column?
--    (Expected: NO. That is the core problem -- see plan step 1.)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ds_grading_categories'
ORDER BY ordinal_position;

-- 4. Full shape of the other grading tables, so the migration targets
--    real column names (esp. ds_student_final_grades, which the app
--    reads weighted_percentage / total_raw_points / is_passing_year from).
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN (
  'ds_assessment_items',
  'ds_student_scores',
  'ds_student_final_grades',
  'ds_quarters',
  'ds_yearly_requirements'
)
ORDER BY table_name, ordinal_position;

-- 5. THE MOST IMPORTANT ONE: source of every grading-related function.
--    calculate_student_grade is the authoritative grade math and is
--    invoked by POST /recalculateGrade. We must read it before editing.
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname IN (
      'calculate_student_grade',
      'get_course_students_grades',
      'get_student_all_scores',
      'get_all_students_scores_by_course'
    )
    OR p.proname ILIKE '%grade%'
    OR p.proname ILIKE '%score%'
  )
ORDER BY p.proname;

-- 6. Any TRIGGERS that auto-recalculate grades when a score changes.
--    If one exists, editing weights silently rewrites historical grades
--    the moment anyone touches a score.
SELECT
  c.relname   AS table_name,
  t.tgname    AS trigger_name,
  p.proname   AS calls_function,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc  p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND c.relname IN (
    'ds_student_scores',
    'ds_assessment_items',
    'ds_student_final_grades',
    'ds_grading_categories'
  )
ORDER BY c.relname, t.tgname;

-- 7. How much live data hangs off each category? Drives whether the
--    attendance/behavior merge and altar-responses removal need a
--    data migration or can just be a flag flip.
SELECT
  gc.category_id,
  gc.category_name,
  gc.weight_percentage,
  COUNT(DISTINCT ai.item_id) AS assessment_items,
  COUNT(ss.score_id)         AS student_scores
FROM ds_grading_categories gc
LEFT JOIN ds_assessment_items ai ON ai.category_id = gc.category_id
LEFT JOIN ds_student_scores   ss ON ss.item_id     = ai.item_id
GROUP BY gc.category_id, gc.category_name, gc.weight_percentage
ORDER BY student_scores DESC;

-- 8. Quarters vs semesters: what is actually in ds_quarters today?
--    The public grading page now says "semester" -- this shows how far
--    the data is from that wording.
SELECT * FROM ds_quarters ORDER BY start_date DESC;

-- 9. How many already-computed final grades exist, by year? These are
--    the rows a weight change would retroactively invalidate.
SELECT
  academic_year,
  COUNT(*) AS final_grade_rows,
  MIN(calculated_at) AS first_calculated,
  MAX(calculated_at) AS last_calculated
FROM ds_student_final_grades
GROUP BY academic_year
ORDER BY academic_year DESC;

-- 10. Sanity check for the late-test policy: do assessment items or
--     scores carry ANY date we could compare to determine lateness?
--     (Expected: items have no due date; scores only have scored_date.)
SELECT column_name
FROM information_schema.columns
WHERE table_name IN ('ds_assessment_items', 'ds_student_scores')
  AND (column_name ILIKE '%date%' OR column_name ILIKE '%due%' OR column_name ILIKE '%late%')
ORDER BY table_name, column_name;

-- ================================================================
-- 11. FULL function metadata -- not just the body.
--     A CREATE OR REPLACE must reproduce the signature, return type,
--     SECURITY DEFINER-ness, volatility and search_path EXACTLY, or
--     PostgREST will fail to resolve the call from
--     deaconsSchool.js:6625 (which passes 3 named params).
-- ================================================================
SELECT
  p.proname                                AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_function_result(p.oid)            AS returns,
  p.prosecdef                              AS security_definer,
  p.provolatile                            AS volatility,
  p.proconfig                              AS config_search_path,
  pg_get_userbyid(p.proowner)              AS owner,
  pg_get_functiondef(p.oid)                AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'calculate_student_grade',
    'get_course_students_grades',
    'get_student_all_scores',
    'get_all_students_scores_by_course'
  );

-- 12. Grants. CREATE OR REPLACE preserves them; DROP + CREATE does not.
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND (routine_name ILIKE '%grade%' OR routine_name ILIKE '%score%')
ORDER BY routine_name, grantee;

-- 13. Constraints + indexes on the grading tables.
--     Two things depend on this:
--       (a) the exact ON CONFLICT target the rewritten function must use
--       (b) settling the live bug where submitBatchScores uses
--           onConflict "student_id,course_id,quarter_id,item_id"
--           (deaconsSchool.js:6177) but submitStudentScore uses
--           "student_id,course_id,item_id" (:6400, :6415) -- one of
--           these does not match the real index and is throwing today.
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
  'ds_student_final_grades'::regclass,
  'ds_student_scores'::regclass,
  'ds_assessment_items'::regclass,
  'ds_grading_categories'::regclass
)
ORDER BY 1, 2;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('ds_student_scores', 'ds_student_final_grades', 'ds_assessment_items')
ORDER BY tablename, indexname;

-- 14. THE BIGGEST UNKNOWN: are attendance and behavior graded through
--     ds_assessment_items, or derived from ds_attendance directly?
--     This determines whether the 20% Attendance & Behavior bucket is
--     scored like everything else or needs its own code path.
SELECT gc.category_name,
       COUNT(DISTINCT ai.item_id) AS assessment_items,
       COUNT(ss.score_id)         AS student_scores
FROM ds_grading_categories gc
LEFT JOIN ds_assessment_items ai ON ai.category_id = gc.category_id
LEFT JOIN ds_student_scores   ss ON ss.item_id     = ai.item_id
WHERE lower(gc.category_name) IN ('attendance', 'behavior')
GROUP BY gc.category_name;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('ds_attendance', 'ds_class_sessions')
ORDER BY table_name, ordinal_position;

-- 15. The NULL-quarter question. add-grades.component.ts:586,633 writes
--     quarter_id as null. If calculate_student_grade filters on quarter,
--     those scores may be invisible to the authoritative math.
SELECT quarter_id IS NULL AS quarter_is_null, COUNT(*) AS scores
FROM ds_student_scores
GROUP BY 1;

-- 16. RLS -- would block the new weight/policy tables from the API key.
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname LIKE 'ds_%' AND relkind = 'r'
ORDER BY relname;

SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename LIKE 'ds_%'
ORDER BY tablename, policyname;

-- 17. Is pgcrypto available? The new tables use gen_random_uuid().
SELECT extname FROM pg_extension ORDER BY extname;

-- 18. Which academic years exist, and which is current/closed.
--     The migration never hardcodes a year label -- it resolves from here.
SELECT year_id, year_label, start_date, end_date, is_current, is_closed
FROM ds_academic_years
ORDER BY start_date;
