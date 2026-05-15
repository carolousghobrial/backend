-- Add webhook tracking columns to altar_responses_course table
ALTER TABLE public.altar_responses_course
  ADD COLUMN IF NOT EXISTS payment_confirmed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_error text;
