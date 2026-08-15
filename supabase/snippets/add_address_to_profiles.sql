-- ================================================================
-- Add address Column to profiles Table
-- ================================================================
-- Adds a single free-text address field so members can enter/edit
-- their mailing address from the self-service "Edit Profile" form.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles'
    AND column_name = 'address'
  ) THEN
    ALTER TABLE profiles
    ADD COLUMN address TEXT;

    RAISE NOTICE 'Added address column to profiles';
  ELSE
    RAISE NOTICE 'address column already exists in profiles';
  END IF;
END $$;

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- ALTER TABLE profiles DROP COLUMN IF EXISTS address;
