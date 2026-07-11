-- ================================================================
-- Create Academic Years Table for Deacons School
-- ================================================================

-- Drop table if exists (uncomment if you need to recreate)
-- DROP TABLE IF EXISTS ds_academic_years CASCADE;

-- Create the table
CREATE TABLE IF NOT EXISTS ds_academic_years (
  year_id SERIAL PRIMARY KEY,
  year_label VARCHAR(9) NOT NULL UNIQUE,  -- Format: YYYY-YYYY (e.g., "2024-2025")
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT check_year_label_format CHECK (year_label ~ '^\d{4}-\d{4}$'),
  CONSTRAINT check_date_range CHECK (end_date > start_date),
  CONSTRAINT check_year_sequence CHECK (
    CAST(SUBSTRING(year_label FROM 6 FOR 4) AS INTEGER) = 
    CAST(SUBSTRING(year_label FROM 1 FOR 4) AS INTEGER) + 1
  )
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ds_academic_years_is_current ON ds_academic_years(is_current);
CREATE INDEX IF NOT EXISTS idx_ds_academic_years_start_date ON ds_academic_years(start_date);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ds_academic_years_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ds_academic_years_updated_at ON ds_academic_years;
CREATE TRIGGER trigger_update_ds_academic_years_updated_at
  BEFORE UPDATE ON ds_academic_years
  FOR EACH ROW
  EXECUTE FUNCTION update_ds_academic_years_updated_at();

-- Add constraint to ensure only one current year at a time
CREATE OR REPLACE FUNCTION check_single_current_year()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_current = true THEN
    -- Unset any other current years
    UPDATE ds_academic_years 
    SET is_current = false 
    WHERE year_id != NEW.year_id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_check_single_current_year ON ds_academic_years;
CREATE TRIGGER trigger_check_single_current_year
  BEFORE INSERT OR UPDATE ON ds_academic_years
  FOR EACH ROW
  WHEN (NEW.is_current = true)
  EXECUTE FUNCTION check_single_current_year();

-- Insert sample academic years
-- Adjust dates according to your church's academic calendar
INSERT INTO ds_academic_years (year_label, start_date, end_date, is_current)
VALUES 
  ('2023-2024', '2023-09-01', '2024-06-30', false),
  ('2024-2025', '2024-09-01', '2025-06-30', false),
  ('2025-2026', '2025-09-01', '2026-06-30', true),   -- Current year
  ('2026-2027', '2026-09-01', '2027-06-30', false)
ON CONFLICT (year_label) DO NOTHING;

-- Verify the data
SELECT * FROM ds_academic_years ORDER BY start_date DESC;

-- ================================================================
-- Optional: Add RLS (Row Level Security) policies if needed
-- ================================================================

-- Enable RLS (uncomment if you want to enable)
-- ALTER TABLE ds_academic_years ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read academic years
-- CREATE POLICY "Allow authenticated users to read academic years"
--   ON ds_academic_years FOR SELECT
--   TO authenticated
--   USING (true);

-- Allow service role to manage academic years (for backend)
-- CREATE POLICY "Allow service role full access to academic years"
--   ON ds_academic_years FOR ALL
--   TO service_role
--   USING (true)
--   WITH CHECK (true);
