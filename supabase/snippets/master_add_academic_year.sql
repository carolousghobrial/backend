-- ================================================================
-- MASTER MIGRATION: Add academic_year to All Deacons School Tables
-- ================================================================
-- Run this script in Supabase SQL Editor to add academic_year columns
-- to both ds_courses and ds_student_enrollment tables.
-- ================================================================

-- ================================================================
-- PART 1: Add academic_year to ds_courses
-- ================================================================

-- Step 1.1: Add academic_year column to ds_courses if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ds_courses' 
    AND column_name = 'academic_year'
  ) THEN
    ALTER TABLE ds_courses 
    ADD COLUMN academic_year VARCHAR(9);
    
    RAISE NOTICE 'Added academic_year column to ds_courses';
  ELSE
    RAISE NOTICE 'academic_year column already exists in ds_courses';
  END IF;
END $$;

-- Step 1.2: Populate existing courses with current academic year
DO $$ 
DECLARE
  current_year_label VARCHAR(9);
BEGIN
  SELECT year_label INTO current_year_label
  FROM ds_academic_years
  WHERE is_current = true
  LIMIT 1;
  
  IF current_year_label IS NOT NULL THEN
    UPDATE ds_courses
    SET academic_year = current_year_label
    WHERE academic_year IS NULL;
    
    RAISE NOTICE 'Populated ds_courses.academic_year with: %', current_year_label;
  ELSE
    RAISE WARNING 'No current academic year found!';
  END IF;
END $$;

-- Step 1.3: Add foreign key constraint for ds_courses
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_ds_courses_academic_year'
  ) THEN
    ALTER TABLE ds_courses
    ADD CONSTRAINT fk_ds_courses_academic_year
    FOREIGN KEY (academic_year) 
    REFERENCES ds_academic_years(year_label)
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
    
    RAISE NOTICE 'Added FK constraint: fk_ds_courses_academic_year';
  END IF;
END $$;

-- Step 1.4: Create index for ds_courses
CREATE INDEX IF NOT EXISTS idx_ds_courses_academic_year 
ON ds_courses(academic_year);

-- Step 1.5: Make academic_year NOT NULL for ds_courses
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ds_courses WHERE academic_year IS NULL) THEN
    ALTER TABLE ds_courses 
    ALTER COLUMN academic_year SET NOT NULL;
    
    RAISE NOTICE 'Set ds_courses.academic_year to NOT NULL';
  ELSE
    RAISE WARNING 'Cannot set NOT NULL: some ds_courses still have NULL academic_year';
  END IF;
END $$;

-- ================================================================
-- PART 2: Add academic_year to ds_student_enrollment
-- ================================================================

-- Step 2.1: Add academic_year column to ds_student_enrollment if it doesn't exist
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

-- Step 2.2: Populate existing enrollments with current academic year
DO $$ 
DECLARE
  current_year_label VARCHAR(9);
BEGIN
  SELECT year_label INTO current_year_label
  FROM ds_academic_years
  WHERE is_current = true
  LIMIT 1;
  
  IF current_year_label IS NOT NULL THEN
    UPDATE ds_student_enrollment
    SET academic_year = current_year_label
    WHERE academic_year IS NULL;
    
    RAISE NOTICE 'Populated ds_student_enrollment.academic_year with: %', current_year_label;
  ELSE
    RAISE WARNING 'No current academic year found!';
  END IF;
END $$;

-- Step 2.3: Add foreign key constraint for ds_student_enrollment
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
    
    RAISE NOTICE 'Added FK constraint: fk_ds_student_enrollment_academic_year';
  END IF;
END $$;

-- Step 2.4: Create indexes for ds_student_enrollment
CREATE INDEX IF NOT EXISTS idx_ds_student_enrollment_academic_year 
ON ds_student_enrollment(academic_year);

CREATE INDEX IF NOT EXISTS idx_ds_student_enrollment_student_course_year
ON ds_student_enrollment(student_id, course_id, academic_year);

-- Step 2.5: Make academic_year NOT NULL for ds_student_enrollment
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ds_student_enrollment WHERE academic_year IS NULL) THEN
    ALTER TABLE ds_student_enrollment 
    ALTER COLUMN academic_year SET NOT NULL;
    
    RAISE NOTICE 'Set ds_student_enrollment.academic_year to NOT NULL';
  ELSE
    RAISE WARNING 'Cannot set NOT NULL: some enrollments still have NULL academic_year';
  END IF;
END $$;

-- ================================================================
-- VERIFICATION
-- ================================================================

-- Summary of changes
DO $$
DECLARE
  courses_count INTEGER;
  enrollment_count INTEGER;
  current_year VARCHAR(9);
BEGIN
  SELECT COUNT(*) INTO courses_count FROM ds_courses;
  SELECT COUNT(*) INTO enrollment_count FROM ds_student_enrollment;
  SELECT year_label INTO current_year FROM ds_academic_years WHERE is_current = true;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'MIGRATION COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Current academic year: %', current_year;
  RAISE NOTICE 'Total courses: %', courses_count;
  RAISE NOTICE 'Total enrollments: %', enrollment_count;
  RAISE NOTICE '========================================';
END $$;

-- Detailed verification
SELECT 
  'ds_courses' as table_name,
  academic_year,
  COUNT(*) as count,
  COUNT(CASE WHEN is_active THEN 1 END) as active_count
FROM ds_courses
GROUP BY academic_year
UNION ALL
SELECT 
  'ds_student_enrollment' as table_name,
  academic_year,
  COUNT(*) as count,
  COUNT(CASE WHEN is_active THEN 1 END) as active_count
FROM ds_student_enrollment
GROUP BY academic_year
ORDER BY table_name, academic_year DESC;

-- Verify constraints
SELECT 
  table_name,
  constraint_name,
  constraint_type
FROM information_schema.table_constraints
WHERE constraint_name IN (
  'fk_ds_courses_academic_year',
  'fk_ds_student_enrollment_academic_year'
)
ORDER BY table_name;

-- ================================================================
-- ROLLBACK (if needed)
-- ================================================================
-- Uncomment to undo all changes:

-- ALTER TABLE ds_student_enrollment DROP CONSTRAINT IF EXISTS fk_ds_student_enrollment_academic_year;
-- DROP INDEX IF EXISTS idx_ds_student_enrollment_academic_year;
-- DROP INDEX IF EXISTS idx_ds_student_enrollment_student_course_year;
-- ALTER TABLE ds_student_enrollment DROP COLUMN IF EXISTS academic_year;

-- ALTER TABLE ds_courses DROP CONSTRAINT IF EXISTS fk_ds_courses_academic_year;
-- DROP INDEX IF EXISTS idx_ds_courses_academic_year;
-- ALTER TABLE ds_courses DROP COLUMN IF EXISTS academic_year;
