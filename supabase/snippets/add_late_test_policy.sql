-- ================================================================
-- Phase 2: Late Test Policy Schema (additive, zero behavior change)
-- ================================================================
-- Run AFTER add_year_scoped_grading_weights.sql. This adds the columns
-- needed to express "when was this due" and "when did the student
-- actually take it" -- neither currently exists anywhere in the
-- schema. Every new column is nullable/defaulted and every existing
-- academic year has late_policy_enabled = false (set in Phase 1), so
-- this migration cannot change any grade by itself: due_date starts
-- NULL everywhere, and ds_late_cap_pct() returns 100 whenever due_date
-- or taken_date is NULL.
-- ================================================================

-- Step 1: due_date lives on the assessment item -- the deadline is a
-- property of the assessment, not of any one student's score.
ALTER TABLE ds_assessment_items ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE ds_assessment_items ADD COLUMN IF NOT EXISTS apply_late_policy boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN ds_assessment_items.due_date IS
  'Deadline for this assessment. NULL means the late-test cap never applies to it, regardless of policy.late_policy_enabled.';
COMMENT ON COLUMN ds_assessment_items.apply_late_policy IS
  'Per-item override to exempt an item from the late cap even when it has a due_date (e.g. a deliberately-timed extra credit item). Extra-credit items (is_extra_credit) are exempt by default regardless of this flag.';

-- Step 2: when the student actually took it, plus teacher
-- overrides/excuses. taken_date is deliberately separate from
-- scored_date: scored_date is server-set ("when a teacher entered
-- this"), taken_date is teacher-editable ("when the student sat the
-- test"). Conflating them would penalize students for slow grading.
ALTER TABLE ds_student_scores ADD COLUMN IF NOT EXISTS taken_date date;
ALTER TABLE ds_student_scores ADD COLUMN IF NOT EXISTS late_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE ds_student_scores ADD COLUMN IF NOT EXISTS late_cap_override numeric(5,2)
  CHECK (late_cap_override IS NULL OR (late_cap_override >= 0 AND late_cap_override <= 100));
ALTER TABLE ds_student_scores ADD COLUMN IF NOT EXISTS late_reason text;
ALTER TABLE ds_student_scores ADD COLUMN IF NOT EXISTS late_override_by text;
ALTER TABLE ds_student_scores ADD COLUMN IF NOT EXISTS late_override_at timestamptz;

COMMENT ON COLUMN ds_student_scores.taken_date IS
  'When the student actually took/submitted this assessment. Distinct from scored_date (when a teacher entered the score). Used to compute lateness against ds_assessment_items.due_date. Falls back to scored_date at read time (see ds_late_cap_pct callers) when NULL -- deliberately never backfilled here.';
COMMENT ON COLUMN ds_student_scores.late_exempt IS
  'Teacher-set excuse (illness, travel, class cancelled, etc). When true, the late cap is always 100 regardless of dates. Requires late_reason.';
COMMENT ON COLUMN ds_student_scores.late_cap_override IS
  'Teacher-set partial mercy cap (e.g. 85 instead of a formula-computed 55). Takes priority over the formula but not over late_exempt. Requires late_reason.';

-- NOTE: no backfill of taken_date here (there was one; it was removed).
-- Every caller of ds_late_cap_pct uses COALESCE(taken_date, scored_date),
-- so backfilling is functionally unnecessary -- and it was actively
-- dangerous: UPDATE-ing every row in ds_student_scores fires the
-- existing trg_calculate_student_grade trigger for every row
-- simultaneously, which surfaced a pre-existing bug (see
-- fix_ds_student_final_grades_academic_year.sql). Run that fix file
-- FIRST if you haven't, regardless of whether you ever need this
-- backfill -- that trigger fires on ordinary score entry through the
-- app too.

-- Step 3: the cap function. A CEILING on achievable points, not a
-- flat percentage subtraction -- LEAST(points_earned, points_possible
-- * cap / 100) means a student who scores BELOW the cap is unaffected;
-- only scores above the cap get clipped.
--
-- Formula: 100 on time; otherwise
--   cap = GREATEST(0, (first_week_cap + weekly_drop) - weekly_drop * ceil(days_late / 7))
-- With defaults (85, 15) this reduces to 100 - 15*ceil(days_late/7):
--   0 days late      -> 100
--   1-7 days late    -> 85
--   8-14 days late   -> 70
--   15-21 days late  -> 55
--   22-28 days late  -> 40
--   29-35 days late  -> 25
--   36-42 days late  -> 10
--   43+ days late    -> 0
-- This matches the published policy on the public grading page
-- (frontend/.../deaconsSchool/grading/grading.component.ts,
-- getLateTestMaxScore) exactly.
CREATE OR REPLACE FUNCTION ds_late_cap_pct(
  p_due          date,
  p_taken        date,
  p_first_week_cap numeric DEFAULT 85,
  p_weekly_drop     numeric DEFAULT 15,
  p_grace_days      integer DEFAULT 0
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_due IS NULL OR p_taken IS NULL THEN 100
    WHEN p_taken <= p_due + p_grace_days  THEN 100
    ELSE GREATEST(
      0,
      (p_first_week_cap + p_weekly_drop)
      - p_weekly_drop * CEIL((p_taken - p_due - p_grace_days)::numeric / 7.0)
    )
  END;
$$;

COMMENT ON FUNCTION ds_late_cap_pct IS
  'Maximum achievable score (0-100) for a test taken p_taken when due p_due. Returns 100 when either date is NULL, i.e. the late policy is inert until both an item due_date and a score taken_date exist.';

CREATE INDEX IF NOT EXISTS idx_ds_assessment_items_due_date
  ON ds_assessment_items(due_date) WHERE due_date IS NOT NULL;

-- ================================================================
-- Verification Queries
-- ================================================================

-- Cap table: must read 100, then 85 x7, 70 x7, 55 x7, 40 x7, 25 x7, 10 x7, then 0.
SELECT
  d AS days_late,
  ds_late_cap_pct(DATE '2026-09-01', DATE '2026-09-01' + d) AS max_score
FROM generate_series(0, 45) d
ORDER BY d;

-- Confirm the late policy is currently inert everywhere (no due_date
-- set yet, so this migration changed nothing observable). Expect 0
-- items_with_due_date, and scores_missing_taken_date == total row
-- count (taken_date is intentionally NOT backfilled -- see the NOTE
-- above Step 3).
SELECT COUNT(*) AS items_with_due_date FROM ds_assessment_items WHERE due_date IS NOT NULL;
SELECT COUNT(*) AS scores_missing_taken_date FROM ds_student_scores WHERE taken_date IS NULL;
SELECT COUNT(*) AS total_scores FROM ds_student_scores;

-- New columns exist with the expected defaults.
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'ds_assessment_items' AND column_name IN ('due_date', 'apply_late_policy')
UNION ALL
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'ds_student_scores'
  AND column_name IN ('taken_date', 'late_exempt', 'late_cap_override', 'late_reason', 'late_override_by', 'late_override_at')
ORDER BY column_name;

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- DROP FUNCTION IF EXISTS ds_late_cap_pct(date, date, numeric, numeric, integer);
-- DROP INDEX IF EXISTS idx_ds_assessment_items_due_date;
-- ALTER TABLE ds_assessment_items DROP COLUMN IF EXISTS due_date;
-- ALTER TABLE ds_assessment_items DROP COLUMN IF EXISTS apply_late_policy;
-- ALTER TABLE ds_student_scores DROP COLUMN IF EXISTS taken_date;
-- ALTER TABLE ds_student_scores DROP COLUMN IF EXISTS late_exempt;
-- ALTER TABLE ds_student_scores DROP COLUMN IF EXISTS late_cap_override;
-- ALTER TABLE ds_student_scores DROP COLUMN IF EXISTS late_reason;
-- ALTER TABLE ds_student_scores DROP COLUMN IF EXISTS late_override_by;
-- ALTER TABLE ds_student_scores DROP COLUMN IF EXISTS late_override_at;
