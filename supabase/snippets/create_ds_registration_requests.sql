-- Deacon School manual registration requests.
-- Submitted from the public registration page when a DOB + last-name lookup
-- finds no directory record. A coordinator later links each request to a
-- portal profile (status -> 'linked') or rejects it (status -> 'rejected').

CREATE TABLE IF NOT EXISTS public.ds_registration_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  dob              date NOT NULL,
  cellphone        text,
  email            text,
  previous_level   text,
  notes            text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'linked', 'rejected')),
  linked_portal_id text,
  reviewed_by      text,
  reviewed_at      timestamptz,
  -- Registrants pay the $25 fee up front; a coordinator enrolls them after.
  payment_reference    text,
  payment_amount_cents integer,
  paid_at              timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ds_registration_requests_status
  ON public.ds_registration_requests (status, created_at DESC);

-- Writes go through the backend using the service-role key, which bypasses RLS.
-- Enable RLS with no permissive policies so the table is not reachable via the
-- public anon/authenticated PostgREST API.
ALTER TABLE public.ds_registration_requests ENABLE ROW LEVEL SECURITY;
