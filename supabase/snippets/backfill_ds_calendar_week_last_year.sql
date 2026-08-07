-- ================================================================
-- Backfill Old ds_calendar_week Rows to Last Year
-- ================================================================
-- Run this AFTER add_academic_year_to_calendar.sql.
--
-- All ds_calendar_week rows that predate the academic_year column belong
-- to a single completed year (the admin calendar page only ever tracked
-- one year's worth of dates before this feature existed). If the
-- date-range backfill in add_academic_year_to_calendar.sql left any rows
-- with academic_year still NULL (calendar_day didn't fall inside any
-- ds_academic_years start_date/end_date range), this assigns them to
-- "last year" explicitly instead.
--
-- "Last year" = the latest is_closed = true year_label, matching the
-- convention already used elsewhere in this app (see
-- ds-academic-year-semantics memory: is_current is not a reliable
-- pointer to "last year" since it flips meaning at rollover).
-- ================================================================

DO $$
DECLARE
  last_year_label VARCHAR(9);
  updated_count INT;
BEGIN
  SELECT year_label INTO last_year_label
  FROM ds_academic_years
  WHERE is_closed = true
  ORDER BY year_label DESC
  LIMIT 1;

  IF last_year_label IS NULL THEN
    RAISE EXCEPTION 'No is_closed=true academic year found -- cannot determine "last year". Set one manually.';
  END IF;

  UPDATE ds_calendar_week
  SET academic_year = last_year_label
  WHERE academic_year IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Set academic_year = % on % previously-unassigned ds_calendar_week row(s)', last_year_label, updated_count;
END $$;

-- ================================================================
-- Verification
-- ================================================================

SELECT academic_year, level, COUNT(*) AS week_count
FROM ds_calendar_week
GROUP BY academic_year, level
ORDER BY academic_year DESC, level;

SELECT calendar_id, level, calendar_day
FROM ds_calendar_week
WHERE academic_year IS NULL;

-- Now that every row should be assigned, you can re-run Step 6 of
-- add_academic_year_to_calendar.sql to set the column NOT NULL:
--
-- ALTER TABLE ds_calendar_week ALTER COLUMN academic_year SET NOT NULL;
