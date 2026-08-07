-- ================================================================
-- Add academic_year Column to ds_calendar_week Table
-- ================================================================
-- ds_calendar_week was previously keyed uniquely on (calendar_day, level).
-- Since ds_courses.level (e.g. "ds_level_alpha") is reused across every
-- academic year, the admin "Edit DS Calendar" page's save endpoint
-- (addDSCalendarForLevel) upserted on that key alone. In practice this
-- happened not to collide across years only because real calendar_day
-- values differ year to year -- but it meant the calendar had no explicit
-- per-year identity, and any future year whose weekly dates coincided with
-- a prior year's dates would silently overwrite that year's row instead of
-- creating a new one. This migration gives every row an explicit
-- academic_year so saving a new year's calendar always adds new rows.
--
-- Backfill is derived from each row's own calendar_day, matched against
-- ds_academic_years' start_date/end_date ranges -- not hardcoded to
-- whichever year is currently is_current, since that flag flips meaning
-- at year-end rollover (see ds-academic-year-semantics memory).
-- ================================================================

-- Step 1: Add academic_year column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ds_calendar_week'
    AND column_name = 'academic_year'
  ) THEN
    ALTER TABLE ds_calendar_week
    ADD COLUMN academic_year VARCHAR(9);

    RAISE NOTICE 'Added academic_year column to ds_calendar_week';
  ELSE
    RAISE NOTICE 'academic_year column already exists in ds_calendar_week';
  END IF;
END $$;

-- Step 2: Backfill from each row's own calendar_day, matched to the
-- academic year whose date range contains it. Only touches rows that
-- don't already have a value, so this is safe to re-run.
UPDATE ds_calendar_week cw
SET academic_year = ay.year_label
FROM ds_academic_years ay
WHERE cw.calendar_day BETWEEN ay.start_date AND ay.end_date
  AND cw.academic_year IS NULL;

-- Step 3: Drop the old (calendar_day, level) unique constraint, whatever
-- it happens to be named, and replace it with one that also includes
-- academic_year. Looked up dynamically since the original constraint name
-- wasn't recorded anywhere in the codebase.
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_name = 'ds_calendar_week'
      AND tc.constraint_type = 'UNIQUE'
      AND tc.constraint_name IN (
        SELECT constraint_name
        FROM information_schema.key_column_usage
        WHERE table_name = 'ds_calendar_week'
        GROUP BY constraint_name
        HAVING array_agg(column_name::text ORDER BY column_name::text) = ARRAY['calendar_day', 'level']
      )
  LOOP
    EXECUTE format('ALTER TABLE ds_calendar_week DROP CONSTRAINT %I', con.constraint_name);
    RAISE NOTICE 'Dropped old unique constraint %', con.constraint_name;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'uq_ds_calendar_week_day_level_year'
  ) THEN
    ALTER TABLE ds_calendar_week
    ADD CONSTRAINT uq_ds_calendar_week_day_level_year
    UNIQUE (calendar_day, level, academic_year);

    RAISE NOTICE 'Added unique constraint uq_ds_calendar_week_day_level_year';
  ELSE
    RAISE NOTICE 'Unique constraint uq_ds_calendar_week_day_level_year already exists';
  END IF;
END $$;

-- Step 4: Add foreign key constraint, matching the pattern used on other
-- ds_* tables that carry academic_year
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_ds_calendar_week_academic_year'
  ) THEN
    ALTER TABLE ds_calendar_week
    ADD CONSTRAINT fk_ds_calendar_week_academic_year
    FOREIGN KEY (academic_year)
    REFERENCES ds_academic_years(year_label)
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

    RAISE NOTICE 'Added foreign key constraint fk_ds_calendar_week_academic_year';
  ELSE
    RAISE NOTICE 'Foreign key constraint already exists';
  END IF;
END $$;

-- Step 5: Index for the year-scoped queries this unblocks
CREATE INDEX IF NOT EXISTS idx_ds_calendar_week_academic_year
ON ds_calendar_week(academic_year);

-- Step 6: NOT NULL only if every row backfilled successfully -- if any
-- calendar_day falls outside every academic year's date range, this
-- intentionally stays nullable rather than blocking the migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ds_calendar_week WHERE academic_year IS NULL) THEN
    ALTER TABLE ds_calendar_week
    ALTER COLUMN academic_year SET NOT NULL;

    RAISE NOTICE 'Set academic_year to NOT NULL';
  ELSE
    RAISE WARNING 'Cannot set NOT NULL: some calendar rows still have NULL academic_year (calendar_day outside any academic year range?)';
  END IF;
END $$;

-- ================================================================
-- Verification Queries
-- ================================================================

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ds_calendar_week'
ORDER BY ordinal_position;

SELECT academic_year, level, COUNT(*) AS week_count
FROM ds_calendar_week
GROUP BY academic_year, level
ORDER BY academic_year DESC, level;

-- Any calendar rows that couldn't be backfilled (calendar_day outside
-- every known academic year's date range).
SELECT calendar_id, level, calendar_day
FROM ds_calendar_week
WHERE academic_year IS NULL;

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- ALTER TABLE ds_calendar_week DROP CONSTRAINT IF EXISTS fk_ds_calendar_week_academic_year;
-- ALTER TABLE ds_calendar_week DROP CONSTRAINT IF EXISTS uq_ds_calendar_week_day_level_year;
-- ALTER TABLE ds_calendar_week ADD CONSTRAINT ds_calendar_week_calendar_day_level_key UNIQUE (calendar_day, level);
-- DROP INDEX IF EXISTS idx_ds_calendar_week_academic_year;
-- ALTER TABLE ds_calendar_week DROP COLUMN IF EXISTS academic_year;
