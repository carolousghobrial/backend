-- ================================================================
-- URGENT FIX: ds_student_final_grades.academic_year NOT NULL violation
-- ================================================================
-- Discovered 2026-08-11 while running add_late_test_policy.sql: the
-- existing trigger trg_calculate_student_grade fires on every INSERT/
-- UPDATE to ds_student_scores and calls calculate_student_grade(text,
-- uuid), which INSERTs/UPDATEs ds_student_final_grades WITHOUT setting
-- academic_year. Since that column is NOT NULL (added by an earlier
-- migration, add_academic_year_to_final_grades.sql), every score
-- save that goes through this trigger currently fails.
--
-- This is a PRE-EXISTING bug, unrelated to the grading-rubric changes
-- in progress -- it was only surfaced because add_late_test_policy.sql's
-- backfill UPDATE touched every row in ds_student_scores at once,
-- firing the trigger for all of them simultaneously. IMPORTANT: if
-- teachers cannot currently save grades in add-grades, THIS is why,
-- and it predates today's work.
--
-- Fix: a BEFORE INSERT OR UPDATE trigger on ds_student_final_grades
-- that backfills academic_year from ds_courses whenever it's NULL.
-- This does not require knowing calculate_student_grade()'s internals
-- at all -- it runs before ANY write lands in the table, regardless of
-- what wrote it (the mystery trigger function, a future rewritten
-- function, or anything else).
-- ================================================================

CREATE OR REPLACE FUNCTION ds_student_final_grades_set_academic_year()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.academic_year IS NULL THEN
    SELECT academic_year INTO NEW.academic_year
    FROM ds_courses
    WHERE course_id = NEW.course_id;
  END IF;

  IF NEW.academic_year IS NULL THEN
    RAISE EXCEPTION
      'Cannot determine academic_year for ds_student_final_grades: course_id % has no academic_year set in ds_courses',
      NEW.course_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_academic_year ON ds_student_final_grades;
CREATE TRIGGER trg_set_academic_year
  BEFORE INSERT OR UPDATE ON ds_student_final_grades
  FOR EACH ROW
  EXECUTE FUNCTION ds_student_final_grades_set_academic_year();

-- Backfill any rows that already exist with a NULL academic_year
-- (should be none if the NOT NULL constraint is already enforced, but
-- checking defensively).
UPDATE ds_student_final_grades f
SET academic_year = c.academic_year
FROM ds_courses c
WHERE f.course_id = c.course_id
  AND f.academic_year IS NULL;

-- ================================================================
-- Verification
-- ================================================================

-- Should be 0.
SELECT COUNT(*) AS still_null FROM ds_student_final_grades WHERE academic_year IS NULL;

-- Confirm the trigger exists.
SELECT tgname, tgrelid::regclass AS table_name, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_set_academic_year';

-- Sanity check: re-run the exact failing case from the error, if you
-- still have the student_id/course_id handy, to confirm it now succeeds:
-- SELECT calculate_student_grade('97487', 'fc81080e-2806-477f-8978-86e7d54332f0');

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- DROP TRIGGER IF EXISTS trg_set_academic_year ON ds_student_final_grades;
-- DROP FUNCTION IF EXISTS ds_student_final_grades_set_academic_year();
