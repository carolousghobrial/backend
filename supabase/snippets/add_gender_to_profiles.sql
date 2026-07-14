-- ================================================================
-- Add gender Column to profiles Table
-- ================================================================
-- Adds a gender field used to route Deacons School promotions into
-- gender-split classes (5th & 6th Boys/Girls, 7th & 8th Boys/Girls).
-- Prefills it for students already in a gender-split class by reading
-- their current active enrollment's class_name (Boys -> male, Girls ->
-- female). Students with no gender-split enrollment (e.g. Level 4 and
-- below) are left NULL and must be filled in manually via the admin UI.
-- ================================================================

-- Step 1: Add gender column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles'
    AND column_name = 'gender'
  ) THEN
    ALTER TABLE profiles
    ADD COLUMN gender VARCHAR(10) CHECK (gender IN ('male', 'female'));

    RAISE NOTICE 'Added gender column to profiles';
  ELSE
    RAISE NOTICE 'gender column already exists in profiles';
  END IF;
END $$;

-- Step 2: Prefill gender from current active enrollment's class_name
UPDATE profiles p
SET gender = CASE
  WHEN c.class_name ILIKE '%boys%' THEN 'male'
  WHEN c.class_name ILIKE '%girls%' THEN 'female'
END
FROM ds_student_enrollment e
JOIN ds_courses c ON c.course_id = e.course_id
WHERE e.student_id = p.portal_id
  AND e.is_active = true
  AND p.gender IS NULL
  AND (c.class_name ILIKE '%boys%' OR c.class_name ILIKE '%girls%');

-- ================================================================
-- Verification Queries
-- ================================================================

-- Count students by resolved gender
SELECT gender, COUNT(*) AS student_count
FROM profiles
GROUP BY gender;

-- List students still missing gender (need manual entry, e.g. Level 4)
SELECT p.portal_id, p.first_name, p.last_name, p.grade_level, c.class_name
FROM profiles p
JOIN ds_student_enrollment e ON e.student_id = p.portal_id AND e.is_active = true
JOIN ds_courses c ON c.course_id = e.course_id
WHERE p.gender IS NULL;

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- ALTER TABLE profiles DROP COLUMN IF EXISTS gender;
