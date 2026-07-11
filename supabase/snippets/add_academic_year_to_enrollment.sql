-- ================================================================
-- Add academic_year Column to ds_student_enrollment Table
-- ================================================================
-- This migration connects student enrollments to specific academic years,
-- enabling proper year-based filtering and year-end summaries.
-- ================================================================

-- Step 1: Add academic_year column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ds_student_enrollment' 
    AND column_name = 'academic_year'
  ) THEN
    ALTER TABLE ds_student_enrollment 
    ADD COLUMN academic_year VARCHAR(9);
    
    RAISE NOTICE 'Added academic_year column to ds_student_enrollment';
  ELSE
    RAISE NOTICE 'academic_year column already exists in ds_student_enrollment';
  END IF;
END $$;

-- Step 2: Populate existing enrollments with current academic year
-- (Only for enrollments that don't already have an academic_year set)
DO $$ 
DECLARE
  current_year_label VARCHAR(9);
BEGIN
  -- Get the current academic year
  SELECT year_label INTO current_year_label
  FROM ds_academic_years
  WHERE is_current = true
  LIMIT 1;
  
  IF current_year_label IS NOT NULL THEN
    -- Update enrollments that don't have an academic_year
    UPDATE ds_student_enrollment
    SET academic_year = current_year_label
    WHERE academic_year IS NULL;
    
    RAISE NOTICE 'Populated academic_year with current year: %', current_year_label;
  ELSE
    RAISE WARNING 'No current academic year found. Please set one before running this migration.';
  END IF;
END $$;

-- Step 3: Add foreign key constraint (optional but recommended)
-- This ensures data integrity between enrollments and academic years
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_ds_student_enrollment_academic_year'
  ) THEN
    ALTER TABLE ds_student_enrollment
    ADD CONSTRAINT fk_ds_student_enrollment_academic_year
    FOREIGN KEY (academic_year) 
    REFERENCES ds_academic_years(year_label)
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
    
    RAISE NOTICE 'Added foreign key constraint fk_ds_student_enrollment_academic_year';
  ELSE
    RAISE NOTICE 'Foreign key constraint already exists';
  END IF;
END $$;

-- Step 4: Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_ds_student_enrollment_academic_year 
ON ds_student_enrollment(academic_year);

-- Step 5: Create composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_ds_student_enrollment_student_course_year
ON ds_student_enrollment(student_id, course_id, academic_year);

-- Step 6: Make academic_year NOT NULL for future inserts
-- (Only do this after existing data is populated)
DO $$ 
BEGIN
  -- Check if there are any NULL values left
  IF NOT EXISTS (SELECT 1 FROM ds_student_enrollment WHERE academic_year IS NULL) THEN
    -- Make the column NOT NULL
    ALTER TABLE ds_student_enrollment 
    ALTER COLUMN academic_year SET NOT NULL;
    
    RAISE NOTICE 'Set academic_year to NOT NULL';
  ELSE
    RAISE WARNING 'Cannot set NOT NULL constraint: some enrollments still have NULL academic_year';
  END IF;
END $$;

-- ================================================================
-- Verification Queries
-- ================================================================

-- View the updated table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'ds_student_enrollment'
ORDER BY ordinal_position;

-- Check how many enrollments are assigned to each academic year
SELECT 
  academic_year,
  COUNT(*) as enrollment_count,
  COUNT(CASE WHEN is_active THEN 1 END) as active_enrollments,
  COUNT(DISTINCT student_id) as unique_students,
  COUNT(DISTINCT course_id) as unique_courses
FROM ds_student_enrollment
GROUP BY academic_year
ORDER BY academic_year DESC;

-- Verify foreign key constraint
SELECT
  constraint_name,
  table_name,
  constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'ds_student_enrollment'
  AND constraint_name = 'fk_ds_student_enrollment_academic_year';

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- Uncomment the following lines to undo this migration:

-- ALTER TABLE ds_student_enrollment DROP CONSTRAINT IF EXISTS fk_ds_student_enrollment_academic_year;
-- DROP INDEX IF EXISTS idx_ds_student_enrollment_academic_year;
-- DROP INDEX IF EXISTS idx_ds_student_enrollment_student_course_year;
-- ALTER TABLE ds_student_enrollment DROP COLUMN IF EXISTS academic_year;
