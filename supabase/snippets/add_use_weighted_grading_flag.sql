-- ================================================================
-- Add use_weighted_grading flag to ds_grading_policy
-- ================================================================
-- ds_grading_policy already exists (from add_year_scoped_grading_weights.sql,
-- confirmed run). This adds ONE more column to it: a per-year switch
-- that decides whether calculate_student_grade uses the NEW weighted
-- math or the ORIGINAL raw-points-sum math.
--
-- Why this is needed: calculate_student_grade today does not weight
-- categories at all -- it sums raw earned/possible points across
-- hymns+rituals+coptic+memorization+altar_responses+behavior+attendance
-- and divides. Adding real weighting is a genuine formula change, not
-- just a config update -- so the rewritten function must run the OLD
-- formula, byte-for-byte, for every year where this flag is false
-- (every existing year, via the DEFAULT below), and the NEW weighted
-- formula only for years where it's explicitly set true (only the
-- newly-activated year, set later in a revised activate_new_grading_rubric.sql).
-- This is what lets the historical-safety gate keep proving nothing
-- moves for old years, while intentionally allowing the new year's
-- numbers to differ.
-- ================================================================

ALTER TABLE ds_grading_policy ADD COLUMN IF NOT EXISTS use_weighted_grading boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ds_grading_policy.use_weighted_grading IS
  'false = calculate_student_grade uses the original raw-points-sum formula (no category weighting) for this year. true = uses ds_grading_category_weights-driven percentage weighting. Every existing year defaults to false so historical grades are provably unchanged.';

-- ================================================================
-- Verification
-- ================================================================
SELECT academic_year, use_weighted_grading, late_policy_enabled, renormalize_partial, passing_percentage
FROM ds_grading_policy
ORDER BY academic_year DESC;
-- Expect every row to show use_weighted_grading = false right now.

-- ================================================================
-- Rollback
-- ================================================================
-- ALTER TABLE ds_grading_policy DROP COLUMN IF EXISTS use_weighted_grading;
