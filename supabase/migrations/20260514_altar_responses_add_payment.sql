-- Add payment_intent_id column to altar_responses_course table
ALTER TABLE public.altar_responses_course
  ADD COLUMN IF NOT EXISTS payment_intent_id text;
