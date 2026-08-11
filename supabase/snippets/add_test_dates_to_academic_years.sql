-- ================================================================
-- Add test_date_1 / test_date_2 to ds_academic_years
-- ================================================================
-- Two fixed test dates per year (e.g. Dec 12 and May 9) that new
-- assessment items automatically get assigned as their due_date,
-- based on when the item is created -- no manual date entry needed.
-- Nullable: if unset for a year, auto-assignment silently does
-- nothing (falls back to whatever due_date was explicitly provided,
-- or NULL/no cap) rather than erroring.
-- ================================================================

ALTER TABLE ds_academic_years ADD COLUMN IF NOT EXISTS test_date_1 date;
ALTER TABLE ds_academic_years ADD COLUMN IF NOT EXISTS test_date_2 date;

COMMENT ON COLUMN ds_academic_years.test_date_1 IS
  'First fixed test date for this year (e.g. Dec 12). Assessment items created on or before this date auto-assign it as their due_date.';
COMMENT ON COLUMN ds_academic_years.test_date_2 IS
  'Second fixed test date for this year (e.g. May 9). Assessment items created after test_date_1 auto-assign this instead.';

-- Set this year's dates. Adjust the year_label/dates if needed.
UPDATE ds_academic_years
SET test_date_1 = '2026-12-12',
    test_date_2 = '2027-05-09'
WHERE year_label = '2026-2027';

-- ================================================================
-- Verification
-- ================================================================
SELECT year_label, test_date_1, test_date_2 FROM ds_academic_years ORDER BY start_date DESC;

-- ================================================================
-- Rollback
-- ================================================================
-- ALTER TABLE ds_academic_years DROP COLUMN IF EXISTS test_date_1;
-- ALTER TABLE ds_academic_years DROP COLUMN IF EXISTS test_date_2;
