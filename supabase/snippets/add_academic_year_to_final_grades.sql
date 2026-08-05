-- ================================================================
-- Add academic_year Column to ds_student_final_grades Table
-- ================================================================
-- ds_student_final_grades has never carried its own academic_year — several
-- backend queries assumed it did (`.eq("academic_year", academicYear)` on this
-- table) and silently got zero rows back because Postgres rejects filtering on
-- a column that doesn't exist and the error was swallowed in JS. In practice
-- that meant every promotion/registration screen treated all 269 already-
-- calculated final grades as missing, defaulting every student to "repeat
-- current level" instead of their real pass/fail result.
--
-- Backfill is derived from each grade's own course_id -> ds_courses.academic_year
-- (verified beforehand: all 269 existing rows resolve to courses in 2025-2026,
-- so this is not a guess), not hardcoded, so this snippet is safe to reuse if
-- more historical grades are backfilled later.
-- ================================================================

-- Step 1: Add academic_year column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ds_student_final_grades'
    AND column_name = 'academic_year'
  ) THEN
    ALTER TABLE ds_student_final_grades
    ADD COLUMN academic_year VARCHAR(9);

    RAISE NOTICE 'Added academic_year column to ds_student_final_grades';
  ELSE
    RAISE NOTICE 'academic_year column already exists in ds_student_final_grades';
  END IF;
END $$;

-- Step 2: Backfill from the grade's own course -> ds_courses.academic_year.
-- Only touches rows that don't already have a value, so this is safe to re-run.
UPDATE ds_student_final_grades g
SET academic_year = c.academic_year
FROM ds_courses c
WHERE g.course_id = c.course_id
  AND g.academic_year IS NULL;

-- Step 3: Add foreign key constraint, matching the ds_student_enrollment pattern
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_ds_student_final_grades_academic_year'
  ) THEN
    ALTER TABLE ds_student_final_grades
    ADD CONSTRAINT fk_ds_student_final_grades_academic_year
    FOREIGN KEY (academic_year)
    REFERENCES ds_academic_years(year_label)
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

    RAISE NOTICE 'Added foreign key constraint fk_ds_student_final_grades_academic_year';
  ELSE
    RAISE NOTICE 'Foreign key constraint already exists';
  END IF;
END $$;

-- Step 4: Index for the year-scoped queries this unblocks
CREATE INDEX IF NOT EXISTS idx_ds_student_final_grades_academic_year
ON ds_student_final_grades(academic_year);

-- Step 5: NOT NULL only if the backfill actually covered every row — if any
-- grade's course_id doesn't resolve in ds_courses (none do today, verified),
-- this intentionally stays nullable rather than blocking the migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ds_student_final_grades WHERE academic_year IS NULL) THEN
    ALTER TABLE ds_student_final_grades
    ALTER COLUMN academic_year SET NOT NULL;

    RAISE NOTICE 'Set academic_year to NOT NULL';
  ELSE
    RAISE WARNING 'Cannot set NOT NULL: some grade rows still have NULL academic_year (orphaned course_id?)';
  END IF;
END $$;

-- ================================================================
-- Verification Queries
-- ================================================================

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ds_student_final_grades'
ORDER BY ordinal_position;

SELECT academic_year, COUNT(*) AS grade_count,
       COUNT(*) FILTER (WHERE is_passing_year) AS passing,
       COUNT(*) FILTER (WHERE NOT is_passing_year) AS not_passing
FROM ds_student_final_grades
GROUP BY academic_year
ORDER BY academic_year DESC;

-- Any grade rows that couldn't be backfilled (course deleted/renamed since).
SELECT g.grade_id, g.student_id, g.course_id
FROM ds_student_final_grades g
WHERE g.academic_year IS NULL;

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- ALTER TABLE ds_student_final_grades DROP CONSTRAINT IF EXISTS fk_ds_student_final_grades_academic_year;
-- DROP INDEX IF EXISTS idx_ds_student_final_grades_academic_year;
-- ALTER TABLE ds_student_final_grades DROP COLUMN IF EXISTS academic_year;
