-- ================================================================
-- Add payment tracking to ds_registration_requests
-- ================================================================
-- New first-time registrants now pay the $25 fee up front (card) when they
-- submit the "I'm new" form. Record the Stripe payment so a coordinator can
-- see it's paid before connecting + enrolling them.
--   payment_reference    Stripe PaymentIntent id
--   payment_amount_cents amount paid in cents (2500 = $25)
--   paid_at              when the payment was recorded
-- Idempotent — safe to re-run.
-- ================================================================

ALTER TABLE public.ds_registration_requests
  ADD COLUMN IF NOT EXISTS payment_reference    text,
  ADD COLUMN IF NOT EXISTS payment_amount_cents integer,
  ADD COLUMN IF NOT EXISTS paid_at              timestamptz;
