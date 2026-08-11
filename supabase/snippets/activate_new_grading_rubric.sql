-- ================================================================
-- Phase 4: Activate the New Grading Rubric for the Current Year
-- ================================================================
-- Run this ONLY after:
--   1. add_year_scoped_grading_weights.sql (Phase 1) has run
--   2. add_late_test_policy.sql (Phase 2) has run
--   3. rewrite_calculate_student_grade.sql (Phase 3) has been filled
--      in, and its gate query returned zero diffs against every
--      historical row
--
-- This is the ONLY step in the whole migration that changes what any
-- grade actually computes to -- and only for the year that is
-- currently is_current. Every prior year keeps the weights and
-- inert policy backfilled in Phase 1.
--
-- New rubric (must sum to 100 across active categories):
--   Attendance  10%  (existing category, unchanged weight)
--   Behavior    10%  (existing category, unchanged weight)
--     -- together displayed as "Attendance & Behavior 20%" via
--     -- display_group, set in Phase 1. See ds-calendar note: this
--     -- was a deliberate choice over a true merge, since merging
--     -- would repoint ds_assessment_items.category_id globally and
--     -- corrupt every historical year's attendance/behavior split.
--   Hymns       40%  (existing category, unchanged weight)
--   Coptic      15%  (was 10%)
--   Rituals     15%  (was 10%)
--   Memorization 10% (existing category, unchanged weight)
--   Altar Responses -- deactivated for this year only (is_active =
--     false, weight 0). NOT deleted, NOT globally deactivated -- see
--     the comment below.
-- ================================================================

DO $$
DECLARE
  v_year varchar(9);
BEGIN
  SELECT year_label INTO v_year FROM ds_academic_years WHERE is_current = true LIMIT 1;

  IF v_year IS NULL THEN
    RAISE EXCEPTION 'No academic year is marked is_current -- set one via PATCH /academicYears/:yearId/setCurrent before running this migration';
  END IF;

  RAISE NOTICE 'Activating new grading rubric for academic_year = %', v_year;

  -- Coptic -> 15%
  UPDATE ds_grading_category_weights w
  SET weight_percentage = 15, is_active = true
  FROM ds_grading_categories gc
  WHERE w.category_id = gc.category_id
    AND w.academic_year = v_year
    AND lower(gc.category_name) = 'coptic';

  -- Rituals -> 15%
  UPDATE ds_grading_category_weights w
  SET weight_percentage = 15, is_active = true
  FROM ds_grading_categories gc
  WHERE w.category_id = gc.category_id
    AND w.academic_year = v_year
    AND lower(gc.category_name) = 'rituals';

  -- Memorization stays 10% -- explicit, in case Phase 1's backfill
  -- picked up a different legacy value.
  UPDATE ds_grading_category_weights w
  SET weight_percentage = 10, is_active = true
  FROM ds_grading_categories gc
  WHERE w.category_id = gc.category_id
    AND w.academic_year = v_year
    AND lower(gc.category_name) = 'memorization';

  -- Hymns stays 40% -- explicit, same reasoning.
  UPDATE ds_grading_category_weights w
  SET weight_percentage = 40, is_active = true
  FROM ds_grading_categories gc
  WHERE w.category_id = gc.category_id
    AND w.academic_year = v_year
    AND lower(gc.category_name) = 'hymns';

  -- Attendance and Behavior stay 10% each -- explicit.
  UPDATE ds_grading_category_weights w
  SET weight_percentage = 10, is_active = true
  FROM ds_grading_categories gc
  WHERE w.category_id = gc.category_id
    AND w.academic_year = v_year
    AND lower(gc.category_name) IN ('attendance', 'behavior');

  -- Altar Responses: deactivated for THIS YEAR ONLY. Deliberately NOT
  -- a global ds_grading_categories.is_active = false (that would drop
  -- it from GET /getGradingCategories entirely, which both client
  -- grade engines use to decide which categories to include -- a
  -- historical student's altar-responses scores would vanish from
  -- their transcript and recalculating them would shift their grade).
  -- Also deliberately NOT a DELETE: ds_assessment_items.category_id
  -- FKs to this row.
  UPDATE ds_grading_category_weights w
  SET weight_percentage = 0, is_active = false
  FROM ds_grading_categories gc
  WHERE w.category_id = gc.category_id
    AND w.academic_year = v_year
    AND lower(gc.category_name) LIKE '%altar%';

  -- "blank" category (if one exists, per add-grades.component.ts's
  -- category_name !== "blank" filter) has no place in the rubric --
  -- keep it at 0/inactive for the new year too, defensively.
  UPDATE ds_grading_category_weights w
  SET weight_percentage = 0, is_active = false
  FROM ds_grading_categories gc
  WHERE w.category_id = gc.category_id
    AND w.academic_year = v_year
    AND lower(gc.category_name) = 'blank';

  -- "extra_credit" category: discovered live (2026-08) -- not part of
  -- the discovery output, carried a leftover weight from before this
  -- migration. calculate_student_grade's weighted branch never reads
  -- this category's weight at all (extra credit is summed separately
  -- from is_extra_credit=true items and added as a flat bonus), so
  -- this doesn't affect grade math -- it was only inflating the
  -- DISPLAYED total past 100%. Zeroed, but left is_active=true so
  -- teachers can still create extra-credit assignments under it.
  UPDATE ds_grading_category_weights w
  SET weight_percentage = 0
  FROM ds_grading_categories gc
  WHERE w.category_id = gc.category_id
    AND w.academic_year = v_year
    AND lower(gc.category_name) = 'extra_credit';

  -- Enable the late-test policy, mid-year renormalization, AND real
  -- category weighting for the new year only. Every other year keeps
  -- late_policy_enabled=false, renormalize_partial=false,
  -- use_weighted_grading=false from Phase 1 / add_use_weighted_grading_flag.sql
  -- -- this is what makes calculate_student_grade run the ORIGINAL
  -- unweighted formula for every year except this one.
  UPDATE ds_grading_policy
  SET late_policy_enabled = true,
      renormalize_partial = true,
      use_weighted_grading = true,
      updated_at = now(),
      notes = COALESCE(notes || ' | ', '') || 'new rubric activated ' || now()::date
  WHERE academic_year = v_year;

  RAISE NOTICE 'Done. Verify with the queries below before recalculating any grades.';
END $$;

-- ================================================================
-- Verification Queries -- REQUIRED before Phase 7 (recalculating
-- grades for the new year)
-- ================================================================

-- Must show exactly: hymns 40, attendance 10, behavior 10, coptic 15,
-- rituals 15, memorization 10 -- and altar/blank absent (is_active=false).
-- Active sum must be 100.00.
SELECT
  gc.category_name,
  w.weight_percentage,
  w.is_active
FROM ds_grading_category_weights w
JOIN ds_grading_categories gc ON gc.category_id = w.category_id
WHERE w.academic_year = (SELECT year_label FROM ds_academic_years WHERE is_current = true LIMIT 1)
ORDER BY w.is_active DESC, w.weight_percentage DESC;

SELECT
  SUM(weight_percentage) AS active_weight_total
FROM ds_grading_category_weights
WHERE academic_year = (SELECT year_label FROM ds_academic_years WHERE is_current = true LIMIT 1)
  AND is_active;
-- Expected: 100.00

SELECT * FROM ds_grading_policy
WHERE academic_year = (SELECT year_label FROM ds_academic_years WHERE is_current = true LIMIT 1);

-- No historical year's weights or policy should have moved.
SELECT academic_year, SUM(weight_percentage) AS active_weight_total
FROM ds_grading_category_weights
WHERE is_active
GROUP BY academic_year
ORDER BY academic_year DESC;

-- No historical grade should have been recalculated by this migration
-- (this migration never calls calculate_student_grade -- this should
-- always read 0 immediately after running this file).
SELECT COUNT(*) AS unexpected_recalculations
FROM ds_student_final_grades
WHERE academic_year <> (SELECT year_label FROM ds_academic_years WHERE is_current = true LIMIT 1)
  AND calculated_at > (now() - interval '10 minutes');

-- Orphan check: no active assessment item in the new year should
-- point at a category that's inactive/missing for that year.
SELECT c.academic_year, gc.category_name, COUNT(*) AS orphaned_items
FROM ds_assessment_items ai
JOIN ds_courses c ON c.course_id = ai.course_id
JOIN ds_grading_categories gc ON gc.category_id = ai.category_id
LEFT JOIN ds_grading_category_weights w
  ON w.category_id = ai.category_id AND w.academic_year = c.academic_year
WHERE ai.is_active
  AND c.academic_year = (SELECT year_label FROM ds_academic_years WHERE is_current = true LIMIT 1)
  AND (w.weight_id IS NULL OR NOT w.is_active)
GROUP BY 1, 2
ORDER BY 1, 2;
-- Expected: zero rows. If Altar Responses shows up here, a teacher
-- already created assessment items in that category for the new
-- year -- resolve before recalculating (see Phase 5's
-- createAssessmentItem guard, which should prevent this going forward).

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- DO $$
-- DECLARE v_year varchar(9);
-- BEGIN
--   SELECT year_label INTO v_year FROM ds_academic_years WHERE is_current = true LIMIT 1;
--   -- Restore this year's weights to match the legacy values frozen in Phase 1:
--   UPDATE ds_grading_category_weights w
--   SET weight_percentage = s.weight_percentage, is_active = s.is_active
--   FROM ds_grading_categories_snapshot_pre_rubric s
--   WHERE w.category_id = s.category_id AND w.academic_year = v_year;
--
--   UPDATE ds_grading_policy
--   SET late_policy_enabled = false, renormalize_partial = false
--   WHERE academic_year = v_year;
-- END $$;
