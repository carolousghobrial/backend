-- ================================================================
-- Add payment tracking columns to ds_student_enrollment
-- ================================================================
-- Records HOW each enrollment was paid so cash / fee-waived enrollments
-- entered by a priest are distinguishable from card (Stripe) payments.
--   payment_method       'card' | 'cash' | 'waived'  (NULL = legacy/unknown)
--   payment_reference    Stripe PaymentIntent id (card) or NULL
--   payment_amount_cents amount paid in cents (0 for waived)
--   paid_at              when payment was recorded
--   recorded_by          portal_id of the priest who recorded a cash/waived enrollment
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ds_student_enrollment' AND column_name = 'payment_method') THEN
    ALTER TABLE ds_student_enrollment ADD COLUMN payment_method VARCHAR(10);
    ALTER TABLE ds_student_enrollment
      ADD CONSTRAINT ds_student_enrollment_payment_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('card', 'cash', 'waived'));
    RAISE NOTICE 'Added payment_method column';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ds_student_enrollment' AND column_name = 'payment_reference') THEN
    ALTER TABLE ds_student_enrollment ADD COLUMN payment_reference TEXT;
    RAISE NOTICE 'Added payment_reference column';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ds_student_enrollment' AND column_name = 'payment_amount_cents') THEN
    ALTER TABLE ds_student_enrollment ADD COLUMN payment_amount_cents INTEGER;
    RAISE NOTICE 'Added payment_amount_cents column';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ds_student_enrollment' AND column_name = 'paid_at') THEN
    ALTER TABLE ds_student_enrollment ADD COLUMN paid_at TIMESTAMPTZ;
    RAISE NOTICE 'Added paid_at column';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ds_student_enrollment' AND column_name = 'recorded_by') THEN
    ALTER TABLE ds_student_enrollment ADD COLUMN recorded_by TEXT;
    RAISE NOTICE 'Added recorded_by column';
  END IF;
END $$;

-- ================================================================
-- Rollback (if needed)
-- ================================================================
-- ALTER TABLE ds_student_enrollment DROP CONSTRAINT IF EXISTS ds_student_enrollment_payment_method_check;
-- ALTER TABLE ds_student_enrollment DROP COLUMN IF EXISTS payment_method;
-- ALTER TABLE ds_student_enrollment DROP COLUMN IF EXISTS payment_reference;
-- ALTER TABLE ds_student_enrollment DROP COLUMN IF EXISTS payment_amount_cents;
-- ALTER TABLE ds_student_enrollment DROP COLUMN IF EXISTS paid_at;
-- ALTER TABLE ds_student_enrollment DROP COLUMN IF EXISTS recorded_by;
