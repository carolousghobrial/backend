-- ================================================================
-- Add is_closed column to ds_academic_years table
-- Migration Date: 2026-07-10
-- ================================================================

-- Add the is_closed column
ALTER TABLE ds_academic_years 
ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT false;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_ds_academic_years_is_closed 
ON ds_academic_years(is_closed);

-- Add comment to document the column
COMMENT ON COLUMN ds_academic_years.is_closed IS 
'Indicates if the academic year has been closed. No grades or attendance can be recorded for closed years.';

-- Verify the change
SELECT 
  year_id,
  year_label,
  is_current,
  is_closed,
  start_date,
  end_date
FROM ds_academic_years 
ORDER BY start_date DESC;

-- ================================================================
