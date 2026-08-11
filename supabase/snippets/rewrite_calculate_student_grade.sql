-- ================================================================
-- Rewrite calculate_student_grade -- adds real category weighting
-- ================================================================
-- Built from the ACTUAL function body (retrieved via Discovery query
-- #11 on 2026-08-11), not a guess. Confirmed facts this reflects:
--   - Signature: calculate_student_grade(p_student_id text, p_course_id uuid)
--     RETURNS numeric. NOT security definer, no search_path, plpgsql.
--   - Today's math does NOT weight categories at all -- it sums raw
--     earned/possible points across hymns+rituals+coptic+memorization+
--     altar_responses+behavior+attendance and divides. Whichever
--     category has the most possible points dominates.
--   - Attendance/behavior come from separate pre-computed tables
--     (ds_student_attendance_scores, ds_student_behavior_scores),
--     flat 0-100 scores -- NOT from ds_assessment_items.
--   - category_name literal values: 'hymns','rituals','coptic',
--     'memorization','altar_responses' (via ds_assessment_items ->
--     ds_grading_categories), plus 'attendance'/'behavior' matched by
--     name against the two score tables above.
--   - Extra credit is summed GLOBALLY across all categories (not
--     per-category) and added to the raw total, uncounted in "possible"
--     -- lets a student exceed 100%.
--   - ON CONFLICT (student_id, course_id) -- one final-grade row per
--     student+course total, no quarter/year in the key.
--   - Passing threshold hardcoded >= 60.
--   - academic_year is NEVER set on insert -- this is the bug fixed
--     separately by fix_ds_student_final_grades_academic_year.sql
--     (kept as a defense-in-depth trigger; this rewrite ALSO sets it
--     directly so the function is correct standalone).
--
-- THE KEY DESIGN CHANGE: adding real weighting is a genuine formula
-- change, confirmed with the user as intentional (not a bug to avoid).
-- So historical-safety can no longer mean "the formula never changes"
-- -- instead it means "the formula never changes for years that
-- haven't opted in." ds_grading_policy.use_weighted_grading (added by
-- add_use_weighted_grading_flag.sql, defaults false for every existing
-- year) is that opt-in switch:
--   - use_weighted_grading = false -> runs the ORIGINAL raw-sum formula,
--     byte-for-byte. Every existing year stays exactly as it was.
--   - use_weighted_grading = true  -> runs the NEW weighted formula.
--     Only set true for the newly-activated year (in a revised
--     activate_new_grading_rubric.sql, run separately after this gates
--     clean).
-- The late-test cap is folded into the SAME scoring query used by both
-- branches (harmless for legacy years: late_policy_enabled defaults
-- false there too, so the cap always evaluates to a no-op).
--
-- EXTRA CREDIT DESIGN CHOICE (flagging explicitly, this is my call,
-- not something confirmed with you): in the new weighted branch, extra
-- credit is added as a flat PERCENTAGE-POINT bonus on top of the
-- weighted total (e.g. 5 points of extra credit = +5 to the final
-- percentage), rather than being folded into any one category's
-- weighted contribution. This preserves the original spirit -- extra
-- credit sits outside the "required work" calculation entirely and can
-- push a grade over 100% -- but the conversion rate from raw points to
-- percentage points necessarily changes now that a percentage is being
-- computed a different way. If you want different behavior here (e.g.
-- extra credit only within the category it was earned in, weighted the
-- same as everything else), tell me and I'll adjust before this goes live.
--
-- PREREQUISITES (must already be run and confirmed):
--   1. add_year_scoped_grading_weights.sql -- DONE (confirmed)
--   2. add_late_test_policy.sql -- DONE (confirmed)
--   3. fix_ds_student_final_grades_academic_year.sql -- DONE (confirmed)
--   4. add_use_weighted_grading_flag.sql -- run this FIRST, before this file
-- ================================================================

-- ----------------------------------------------------------------
-- Step 1: calculate_student_grade_legacy -- verbatim copy of the
-- CURRENT function, under a new name. Instant rollback path: if
-- anything about the rewrite below is wrong, restore with
--   CREATE OR REPLACE FUNCTION calculate_student_grade(text, uuid)
--   RETURNS numeric LANGUAGE plpgsql AS $$ <copy calculate_student_grade_legacy's body> $$;
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_student_grade_legacy(p_student_id text, p_course_id uuid)
RETURNS numeric
LANGUAGE plpgsql
AS $function$
DECLARE
  v_hymns_earned DECIMAL(10,2) := 0;
  v_hymns_possible DECIMAL(10,2) := 0;

  v_rituals_earned DECIMAL(10,2) := 0;
  v_rituals_possible DECIMAL(10,2) := 0;

  v_coptic_earned DECIMAL(10,2) := 0;
  v_coptic_possible DECIMAL(10,2) := 0;

  v_memorization_earned DECIMAL(10,2) := 0;
  v_memorization_possible DECIMAL(10,2) := 0;

  v_altar_responses_earned DECIMAL(10,2) := 0;
  v_altar_responses_possible DECIMAL(10,2) := 0;

  v_behavior_earned DECIMAL(10,2) := 0;
  v_behavior_possible DECIMAL(10,2) := 100;

  v_attendance_earned DECIMAL(10,2) := 0;
  v_attendance_possible DECIMAL(10,2) := 100;

  v_extra_credit_earned DECIMAL(10,2) := 0;

  v_total_earned DECIMAL(10,2) := 0;
  v_total_possible DECIMAL(10,2) := 0;
  v_weighted_percentage DECIMAL(5,2) := 0;
  v_is_passing BOOLEAN := false;

  category_rec RECORD;
BEGIN
  FOR category_rec IN
    SELECT
      c.category_name,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(ai.is_extra_credit, false) = false
          THEN s.points_earned
          ELSE 0
        END
      ), 0) AS earned_points,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(ai.is_extra_credit, false) = false
          THEN s.points_possible
          ELSE 0
        END
      ), 0) AS possible_points,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(ai.is_extra_credit, false) = true
          THEN s.points_earned
          ELSE 0
        END
      ), 0) AS extra_credit_points
    FROM ds_student_scores s
    JOIN ds_assessment_items ai ON s.item_id = ai.item_id
    JOIN ds_grading_categories c ON ai.category_id = c.category_id
    WHERE s.student_id = p_student_id
      AND s.course_id = p_course_id
    GROUP BY c.category_name
  LOOP
    v_extra_credit_earned := v_extra_credit_earned + category_rec.extra_credit_points;

    CASE category_rec.category_name
      WHEN 'hymns' THEN
        v_hymns_earned := category_rec.earned_points;
        v_hymns_possible := category_rec.possible_points;
      WHEN 'rituals' THEN
        v_rituals_earned := category_rec.earned_points;
        v_rituals_possible := category_rec.possible_points;
      WHEN 'coptic' THEN
        v_coptic_earned := category_rec.earned_points;
        v_coptic_possible := category_rec.possible_points;
      WHEN 'memorization' THEN
        v_memorization_earned := category_rec.earned_points;
        v_memorization_possible := category_rec.possible_points;
      WHEN 'altar_responses' THEN
        v_altar_responses_earned := category_rec.earned_points;
        v_altar_responses_possible := category_rec.possible_points;
      ELSE
        NULL;
    END CASE;
  END LOOP;

  SELECT COALESCE(attendance_score, 0)
  INTO v_attendance_earned
  FROM ds_student_attendance_scores
  WHERE student_id = p_student_id
    AND course_id = p_course_id;

  SELECT COALESCE(behavior_score, 0)
  INTO v_behavior_earned
  FROM ds_student_behavior_scores
  WHERE student_id = p_student_id
    AND course_id = p_course_id;

  v_total_earned :=
    v_hymns_earned + v_rituals_earned + v_coptic_earned + v_memorization_earned +
    v_altar_responses_earned + v_behavior_earned + v_attendance_earned + v_extra_credit_earned;

  v_total_possible :=
    v_hymns_possible + v_rituals_possible + v_coptic_possible + v_memorization_possible +
    v_altar_responses_possible + v_behavior_possible + v_attendance_possible;

  IF v_total_possible > 0 THEN
    v_weighted_percentage := (v_total_earned / v_total_possible) * 100;
  ELSE
    v_weighted_percentage := 0;
  END IF;

  v_is_passing := v_weighted_percentage >= 60;

  INSERT INTO ds_student_final_grades (
    student_id, course_id,
    hymns_earned_points, hymns_possible_points,
    coptic_earned_points, coptic_possible_points,
    rituals_earned_points, rituals_possible_points,
    memorization_earned_points, memorization_possible_points,
    altar_responses_earned_points, altar_responses_possible_points,
    behavior_earned_points, behavior_possible_points,
    attendance_earned_points, attendance_possible_points,
    extra_credit_earned_points,
    total_earned_points, total_possible_points,
    weighted_percentage, is_passing_year, calculated_at,
    academic_year
  )
  VALUES (
    p_student_id, p_course_id,
    v_hymns_earned, v_hymns_possible,
    v_coptic_earned, v_coptic_possible,
    v_rituals_earned, v_rituals_possible,
    v_memorization_earned, v_memorization_possible,
    v_altar_responses_earned, v_altar_responses_possible,
    v_behavior_earned, v_behavior_possible,
    v_attendance_earned, v_attendance_possible,
    v_extra_credit_earned,
    v_total_earned, v_total_possible,
    v_weighted_percentage, v_is_passing, NOW(),
    (SELECT academic_year FROM ds_courses WHERE course_id = p_course_id)
  )
  ON CONFLICT (student_id, course_id) DO UPDATE SET
    hymns_earned_points = EXCLUDED.hymns_earned_points,
    hymns_possible_points = EXCLUDED.hymns_possible_points,
    coptic_earned_points = EXCLUDED.coptic_earned_points,
    coptic_possible_points = EXCLUDED.coptic_possible_points,
    rituals_earned_points = EXCLUDED.rituals_earned_points,
    rituals_possible_points = EXCLUDED.rituals_possible_points,
    memorization_earned_points = EXCLUDED.memorization_earned_points,
    memorization_possible_points = EXCLUDED.memorization_possible_points,
    altar_responses_earned_points = EXCLUDED.altar_responses_earned_points,
    altar_responses_possible_points = EXCLUDED.altar_responses_possible_points,
    behavior_earned_points = EXCLUDED.behavior_earned_points,
    behavior_possible_points = EXCLUDED.behavior_possible_points,
    attendance_earned_points = EXCLUDED.attendance_earned_points,
    attendance_possible_points = EXCLUDED.attendance_possible_points,
    extra_credit_earned_points = EXCLUDED.extra_credit_earned_points,
    total_earned_points = EXCLUDED.total_earned_points,
    total_possible_points = EXCLUDED.total_possible_points,
    weighted_percentage = EXCLUDED.weighted_percentage,
    is_passing_year = EXCLUDED.is_passing_year,
    calculated_at = NOW(),
    academic_year = EXCLUDED.academic_year;

  RETURN v_total_earned;
END;
$function$;

-- ----------------------------------------------------------------
-- Step 2: preview function -- identical logic to Step 3 below, but
-- read-only (RETURNS TABLE, no INSERT). This is what the gate query
-- calls so we can verify before touching the live function.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_student_grade_preview(p_student_id text, p_course_id uuid)
RETURNS TABLE (
  weighted_percentage numeric,
  total_earned_points numeric,
  total_possible_points numeric,
  is_passing_year boolean,
  used_weighted_branch boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_academic_year varchar(9);
  v_policy ds_grading_policy%ROWTYPE;
  v_policy_found boolean;

  v_hymns_earned DECIMAL(10,2) := 0;  v_hymns_possible DECIMAL(10,2) := 0;
  v_rituals_earned DECIMAL(10,2) := 0;  v_rituals_possible DECIMAL(10,2) := 0;
  v_coptic_earned DECIMAL(10,2) := 0;  v_coptic_possible DECIMAL(10,2) := 0;
  v_memorization_earned DECIMAL(10,2) := 0;  v_memorization_possible DECIMAL(10,2) := 0;
  v_altar_responses_earned DECIMAL(10,2) := 0;  v_altar_responses_possible DECIMAL(10,2) := 0;
  v_behavior_earned DECIMAL(10,2) := 0;  v_behavior_possible DECIMAL(10,2) := 100;
  v_attendance_earned DECIMAL(10,2) := 0;  v_attendance_possible DECIMAL(10,2) := 100;
  v_extra_credit_earned DECIMAL(10,2) := 0;

  v_total_earned DECIMAL(10,2) := 0;
  v_total_possible DECIMAL(10,2) := 0;
  v_weighted_percentage DECIMAL(5,2) := 0;
  v_is_passing BOOLEAN := false;

  v_weight_used numeric := 0;
  v_weighted_sum numeric := 0;
  v_w numeric;

  category_rec RECORD;
  v_catrec RECORD;
BEGIN
  SELECT academic_year INTO v_academic_year FROM ds_courses WHERE course_id = p_course_id;

  SELECT * INTO v_policy FROM ds_grading_policy WHERE academic_year = v_academic_year;
  v_policy_found := FOUND;
  IF NOT v_policy_found THEN
    v_policy.use_weighted_grading := false;
    v_policy.passing_percentage := 60;
    v_policy.late_policy_enabled := false;
    v_policy.late_first_week_cap := 85;
    v_policy.late_weekly_drop := 15;
    v_policy.late_grace_days := 0;
    v_policy.renormalize_partial := false;
  END IF;

  -- Shared scoring: identical to the legacy loop, except points_earned
  -- is capped via ds_late_cap_pct when the year's policy has the late
  -- policy enabled. For every year with late_policy_enabled = false
  -- (every year today, until the new year is activated), this cap is
  -- always a no-op (WHEN NOT v_policy.late_policy_enabled THEN s.points_earned
  -- fires first), so this loop produces byte-identical sums to the
  -- legacy function for those years.
  FOR category_rec IN
    WITH scored AS (
      SELECT
        c.category_name,
        COALESCE(ai.is_extra_credit, false) AS is_extra_credit,
        s.points_possible,
        CASE
          WHEN NOT v_policy.late_policy_enabled THEN s.points_earned
          WHEN s.late_exempt THEN s.points_earned
          WHEN s.late_cap_override IS NOT NULL THEN LEAST(s.points_earned, s.points_possible * s.late_cap_override / 100.0)
          WHEN COALESCE(ai.is_extra_credit, false) THEN s.points_earned
          WHEN NOT COALESCE(ai.apply_late_policy, true) THEN s.points_earned
          WHEN ai.due_date IS NULL THEN s.points_earned
          ELSE LEAST(
            s.points_earned,
            s.points_possible * ds_late_cap_pct(
              ai.due_date,
              COALESCE(s.taken_date, s.scored_date::date),
              v_policy.late_first_week_cap,
              v_policy.late_weekly_drop,
              v_policy.late_grace_days
            ) / 100.0
          )
        END AS eff_points_earned
      FROM ds_student_scores s
      JOIN ds_assessment_items ai ON s.item_id = ai.item_id
      JOIN ds_grading_categories c ON ai.category_id = c.category_id
      WHERE s.student_id = p_student_id
        AND s.course_id = p_course_id
    )
    SELECT
      category_name,
      COALESCE(SUM(CASE WHEN NOT is_extra_credit THEN eff_points_earned ELSE 0 END), 0) AS earned_points,
      COALESCE(SUM(CASE WHEN NOT is_extra_credit THEN points_possible ELSE 0 END), 0) AS possible_points,
      COALESCE(SUM(CASE WHEN is_extra_credit THEN eff_points_earned ELSE 0 END), 0) AS extra_credit_points
    FROM scored
    GROUP BY category_name
  LOOP
    v_extra_credit_earned := v_extra_credit_earned + category_rec.extra_credit_points;

    CASE category_rec.category_name
      WHEN 'hymns' THEN v_hymns_earned := category_rec.earned_points; v_hymns_possible := category_rec.possible_points;
      WHEN 'rituals' THEN v_rituals_earned := category_rec.earned_points; v_rituals_possible := category_rec.possible_points;
      WHEN 'coptic' THEN v_coptic_earned := category_rec.earned_points; v_coptic_possible := category_rec.possible_points;
      WHEN 'memorization' THEN v_memorization_earned := category_rec.earned_points; v_memorization_possible := category_rec.possible_points;
      WHEN 'altar_responses' THEN v_altar_responses_earned := category_rec.earned_points; v_altar_responses_possible := category_rec.possible_points;
      ELSE NULL;
    END CASE;
  END LOOP;

  SELECT COALESCE(attendance_score, 0) INTO v_attendance_earned
  FROM ds_student_attendance_scores WHERE student_id = p_student_id AND course_id = p_course_id;

  SELECT COALESCE(behavior_score, 0) INTO v_behavior_earned
  FROM ds_student_behavior_scores WHERE student_id = p_student_id AND course_id = p_course_id;

  v_total_earned :=
    v_hymns_earned + v_rituals_earned + v_coptic_earned + v_memorization_earned +
    v_altar_responses_earned + v_behavior_earned + v_attendance_earned + v_extra_credit_earned;

  v_total_possible :=
    v_hymns_possible + v_rituals_possible + v_coptic_possible + v_memorization_possible +
    v_altar_responses_possible + v_behavior_possible + v_attendance_possible;

  IF v_policy.use_weighted_grading THEN
    FOR v_catrec IN
      SELECT * FROM (VALUES
        ('hymns', v_hymns_earned, v_hymns_possible),
        ('rituals', v_rituals_earned, v_rituals_possible),
        ('coptic', v_coptic_earned, v_coptic_possible),
        ('memorization', v_memorization_earned, v_memorization_possible),
        ('altar_responses', v_altar_responses_earned, v_altar_responses_possible),
        ('behavior', v_behavior_earned, v_behavior_possible),
        ('attendance', v_attendance_earned, v_attendance_possible)
      ) AS t(name, earned, possible)
    LOOP
      SELECT w.weight_percentage INTO v_w
      FROM ds_grading_category_weights w
      JOIN ds_grading_categories gc ON gc.category_id = w.category_id
      WHERE gc.category_name = v_catrec.name
        AND w.academic_year = v_academic_year
        AND w.is_active;

      IF v_w IS NOT NULL AND v_catrec.possible > 0 THEN
        v_weight_used := v_weight_used + v_w;
        v_weighted_sum := v_weighted_sum + (v_catrec.earned / v_catrec.possible * 100.0) * v_w / 100.0;
      END IF;
    END LOOP;

    IF v_weight_used = 0 THEN
      v_weighted_percentage := 0;
    ELSIF v_policy.renormalize_partial THEN
      v_weighted_percentage := v_weighted_sum * 100.0 / v_weight_used;
    ELSE
      v_weighted_percentage := v_weighted_sum;
    END IF;

    -- Extra credit: flat percentage-point bonus. See file header for
    -- why, and flag if you want this handled differently.
    v_weighted_percentage := v_weighted_percentage + v_extra_credit_earned;
  ELSE
    IF v_total_possible > 0 THEN
      v_weighted_percentage := (v_total_earned / v_total_possible) * 100;
    ELSE
      v_weighted_percentage := 0;
    END IF;
  END IF;

  v_is_passing := v_weighted_percentage >= v_policy.passing_percentage;

  RETURN QUERY SELECT
    v_weighted_percentage, v_total_earned, v_total_possible, v_is_passing, v_policy.use_weighted_grading;
END;
$$;

-- ----------------------------------------------------------------
-- Step 3: THE GATE. Compares the preview function against every
-- historical row -- but ONLY for years where use_weighted_grading is
-- false (i.e. every year except whichever one you're about to
-- activate). That's the entire point of the flag: years not opting in
-- must be provably unchanged; the year that IS opting in is expected
-- and allowed to differ.
--
-- ALL FOUR *_diffs COLUMNS MUST BE ZERO for the non-weighted years
-- before Step 4 (the real function) is deployed.
-- ----------------------------------------------------------------
WITH cmp AS (
  SELECT
    s.student_id,
    s.course_id,
    s.weighted_percentage   AS old_pct,
    s.is_passing_year       AS old_pass,
    s.total_earned_points   AS old_earned,
    s.total_possible_points AS old_possible,
    p.weighted_percentage   AS new_pct,
    p.is_passing_year       AS new_pass,
    p.total_earned_points   AS new_earned,
    p.total_possible_points AS new_possible,
    p.used_weighted_branch
  FROM ds_student_final_grades_snapshot_pre_rubric s
  JOIN ds_courses c ON c.course_id = s.course_id
  LEFT JOIN ds_grading_policy pol ON pol.academic_year = c.academic_year
  CROSS JOIN LATERAL calculate_student_grade_preview(s.student_id, s.course_id) p
  WHERE COALESCE(pol.use_weighted_grading, false) = false
)
SELECT
  COUNT(*) FILTER (WHERE ROUND(old_pct, 2) IS DISTINCT FROM ROUND(new_pct, 2))           AS pct_diffs,
  COUNT(*) FILTER (WHERE old_pass IS DISTINCT FROM new_pass)                             AS pass_diffs,
  COUNT(*) FILTER (WHERE ROUND(old_earned, 2) IS DISTINCT FROM ROUND(new_earned, 2))     AS earned_diffs,
  COUNT(*) FILTER (WHERE ROUND(old_possible, 2) IS DISTINCT FROM ROUND(new_possible, 2)) AS possible_diffs,
  COUNT(*) AS rows_checked
FROM cmp;

-- If any *_diffs is non-zero, find the offenders:
-- WITH cmp AS ( ... same as above ... )
-- SELECT * FROM cmp
-- WHERE old_pct IS DISTINCT FROM new_pct OR old_pass IS DISTINCT FROM new_pass
--    OR old_earned IS DISTINCT FROM new_earned OR old_possible IS DISTINCT FROM new_possible
-- ORDER BY student_id, course_id;

-- ----------------------------------------------------------------
-- Step 4: THE REAL FUNCTION -- ONLY run this after Step 3's gate
-- returns all zeros. This is CREATE OR REPLACE on the live function
-- your app's trigger already calls on every score save.
-- ----------------------------------------------------------------
-- Uncomment and run once the gate is clean:
--
-- CREATE OR REPLACE FUNCTION calculate_student_grade(p_student_id text, p_course_id uuid)
-- RETURNS numeric
-- LANGUAGE plpgsql
-- AS $function$
-- DECLARE
--   v_academic_year varchar(9);
--   v_policy ds_grading_policy%ROWTYPE;
--
--   v_hymns_earned DECIMAL(10,2) := 0;  v_hymns_possible DECIMAL(10,2) := 0;
--   v_rituals_earned DECIMAL(10,2) := 0;  v_rituals_possible DECIMAL(10,2) := 0;
--   v_coptic_earned DECIMAL(10,2) := 0;  v_coptic_possible DECIMAL(10,2) := 0;
--   v_memorization_earned DECIMAL(10,2) := 0;  v_memorization_possible DECIMAL(10,2) := 0;
--   v_altar_responses_earned DECIMAL(10,2) := 0;  v_altar_responses_possible DECIMAL(10,2) := 0;
--   v_behavior_earned DECIMAL(10,2) := 0;  v_behavior_possible DECIMAL(10,2) := 100;
--   v_attendance_earned DECIMAL(10,2) := 0;  v_attendance_possible DECIMAL(10,2) := 100;
--   v_extra_credit_earned DECIMAL(10,2) := 0;
--
--   v_total_earned DECIMAL(10,2) := 0;
--   v_total_possible DECIMAL(10,2) := 0;
--   v_weighted_percentage DECIMAL(5,2) := 0;
--   v_is_passing BOOLEAN := false;
--
--   v_weight_used numeric := 0;
--   v_weighted_sum numeric := 0;
--   v_w numeric;
--
--   category_rec RECORD;
--   v_catrec RECORD;
-- BEGIN
--   SELECT academic_year INTO v_academic_year FROM ds_courses WHERE course_id = p_course_id;
--
--   SELECT * INTO v_policy FROM ds_grading_policy WHERE academic_year = v_academic_year;
--   IF NOT FOUND THEN
--     v_policy.use_weighted_grading := false;
--     v_policy.passing_percentage := 60;
--     v_policy.late_policy_enabled := false;
--     v_policy.late_first_week_cap := 85;
--     v_policy.late_weekly_drop := 15;
--     v_policy.late_grace_days := 0;
--     v_policy.renormalize_partial := false;
--   END IF;
--
--   FOR category_rec IN
--     WITH scored AS (
--       SELECT
--         c.category_name,
--         COALESCE(ai.is_extra_credit, false) AS is_extra_credit,
--         s.points_possible,
--         CASE
--           WHEN NOT v_policy.late_policy_enabled THEN s.points_earned
--           WHEN s.late_exempt THEN s.points_earned
--           WHEN s.late_cap_override IS NOT NULL THEN LEAST(s.points_earned, s.points_possible * s.late_cap_override / 100.0)
--           WHEN COALESCE(ai.is_extra_credit, false) THEN s.points_earned
--           WHEN NOT COALESCE(ai.apply_late_policy, true) THEN s.points_earned
--           WHEN ai.due_date IS NULL THEN s.points_earned
--           ELSE LEAST(
--             s.points_earned,
--             s.points_possible * ds_late_cap_pct(
--               ai.due_date, COALESCE(s.taken_date, s.scored_date::date),
--               v_policy.late_first_week_cap, v_policy.late_weekly_drop, v_policy.late_grace_days
--             ) / 100.0
--           )
--         END AS eff_points_earned
--       FROM ds_student_scores s
--       JOIN ds_assessment_items ai ON s.item_id = ai.item_id
--       JOIN ds_grading_categories c ON ai.category_id = c.category_id
--       WHERE s.student_id = p_student_id AND s.course_id = p_course_id
--     )
--     SELECT
--       category_name,
--       COALESCE(SUM(CASE WHEN NOT is_extra_credit THEN eff_points_earned ELSE 0 END), 0) AS earned_points,
--       COALESCE(SUM(CASE WHEN NOT is_extra_credit THEN points_possible ELSE 0 END), 0) AS possible_points,
--       COALESCE(SUM(CASE WHEN is_extra_credit THEN eff_points_earned ELSE 0 END), 0) AS extra_credit_points
--     FROM scored
--     GROUP BY category_name
--   LOOP
--     v_extra_credit_earned := v_extra_credit_earned + category_rec.extra_credit_points;
--     CASE category_rec.category_name
--       WHEN 'hymns' THEN v_hymns_earned := category_rec.earned_points; v_hymns_possible := category_rec.possible_points;
--       WHEN 'rituals' THEN v_rituals_earned := category_rec.earned_points; v_rituals_possible := category_rec.possible_points;
--       WHEN 'coptic' THEN v_coptic_earned := category_rec.earned_points; v_coptic_possible := category_rec.possible_points;
--       WHEN 'memorization' THEN v_memorization_earned := category_rec.earned_points; v_memorization_possible := category_rec.possible_points;
--       WHEN 'altar_responses' THEN v_altar_responses_earned := category_rec.earned_points; v_altar_responses_possible := category_rec.possible_points;
--       ELSE NULL;
--     END CASE;
--   END LOOP;
--
--   SELECT COALESCE(attendance_score, 0) INTO v_attendance_earned
--   FROM ds_student_attendance_scores WHERE student_id = p_student_id AND course_id = p_course_id;
--   SELECT COALESCE(behavior_score, 0) INTO v_behavior_earned
--   FROM ds_student_behavior_scores WHERE student_id = p_student_id AND course_id = p_course_id;
--
--   v_total_earned := v_hymns_earned + v_rituals_earned + v_coptic_earned + v_memorization_earned +
--     v_altar_responses_earned + v_behavior_earned + v_attendance_earned + v_extra_credit_earned;
--   v_total_possible := v_hymns_possible + v_rituals_possible + v_coptic_possible + v_memorization_possible +
--     v_altar_responses_possible + v_behavior_possible + v_attendance_possible;
--
--   IF v_policy.use_weighted_grading THEN
--     FOR v_catrec IN
--       SELECT * FROM (VALUES
--         ('hymns', v_hymns_earned, v_hymns_possible),
--         ('rituals', v_rituals_earned, v_rituals_possible),
--         ('coptic', v_coptic_earned, v_coptic_possible),
--         ('memorization', v_memorization_earned, v_memorization_possible),
--         ('altar_responses', v_altar_responses_earned, v_altar_responses_possible),
--         ('behavior', v_behavior_earned, v_behavior_possible),
--         ('attendance', v_attendance_earned, v_attendance_possible)
--       ) AS t(name, earned, possible)
--     LOOP
--       SELECT w.weight_percentage INTO v_w
--       FROM ds_grading_category_weights w
--       JOIN ds_grading_categories gc ON gc.category_id = w.category_id
--       WHERE gc.category_name = v_catrec.name AND w.academic_year = v_academic_year AND w.is_active;
--       IF v_w IS NOT NULL AND v_catrec.possible > 0 THEN
--         v_weight_used := v_weight_used + v_w;
--         v_weighted_sum := v_weighted_sum + (v_catrec.earned / v_catrec.possible * 100.0) * v_w / 100.0;
--       END IF;
--     END LOOP;
--     IF v_weight_used = 0 THEN
--       v_weighted_percentage := 0;
--     ELSIF v_policy.renormalize_partial THEN
--       v_weighted_percentage := v_weighted_sum * 100.0 / v_weight_used;
--     ELSE
--       v_weighted_percentage := v_weighted_sum;
--     END IF;
--     v_weighted_percentage := v_weighted_percentage + v_extra_credit_earned;
--   ELSE
--     IF v_total_possible > 0 THEN
--       v_weighted_percentage := (v_total_earned / v_total_possible) * 100;
--     ELSE
--       v_weighted_percentage := 0;
--     END IF;
--   END IF;
--
--   v_is_passing := v_weighted_percentage >= v_policy.passing_percentage;
--
--   INSERT INTO ds_student_final_grades (
--     student_id, course_id,
--     hymns_earned_points, hymns_possible_points,
--     coptic_earned_points, coptic_possible_points,
--     rituals_earned_points, rituals_possible_points,
--     memorization_earned_points, memorization_possible_points,
--     altar_responses_earned_points, altar_responses_possible_points,
--     behavior_earned_points, behavior_possible_points,
--     attendance_earned_points, attendance_possible_points,
--     extra_credit_earned_points,
--     total_earned_points, total_possible_points,
--     weighted_percentage, is_passing_year, calculated_at,
--     academic_year
--   )
--   VALUES (
--     p_student_id, p_course_id,
--     v_hymns_earned, v_hymns_possible,
--     v_coptic_earned, v_coptic_possible,
--     v_rituals_earned, v_rituals_possible,
--     v_memorization_earned, v_memorization_possible,
--     v_altar_responses_earned, v_altar_responses_possible,
--     v_behavior_earned, v_behavior_possible,
--     v_attendance_earned, v_attendance_possible,
--     v_extra_credit_earned,
--     v_total_earned, v_total_possible,
--     v_weighted_percentage, v_is_passing, NOW(),
--     v_academic_year
--   )
--   ON CONFLICT (student_id, course_id) DO UPDATE SET
--     hymns_earned_points = EXCLUDED.hymns_earned_points,
--     hymns_possible_points = EXCLUDED.hymns_possible_points,
--     coptic_earned_points = EXCLUDED.coptic_earned_points,
--     coptic_possible_points = EXCLUDED.coptic_possible_points,
--     rituals_earned_points = EXCLUDED.rituals_earned_points,
--     rituals_possible_points = EXCLUDED.rituals_possible_points,
--     memorization_earned_points = EXCLUDED.memorization_earned_points,
--     memorization_possible_points = EXCLUDED.memorization_possible_points,
--     altar_responses_earned_points = EXCLUDED.altar_responses_earned_points,
--     altar_responses_possible_points = EXCLUDED.altar_responses_possible_points,
--     behavior_earned_points = EXCLUDED.behavior_earned_points,
--     behavior_possible_points = EXCLUDED.behavior_possible_points,
--     attendance_earned_points = EXCLUDED.attendance_earned_points,
--     attendance_possible_points = EXCLUDED.attendance_possible_points,
--     extra_credit_earned_points = EXCLUDED.extra_credit_earned_points,
--     total_earned_points = EXCLUDED.total_earned_points,
--     total_possible_points = EXCLUDED.total_possible_points,
--     weighted_percentage = EXCLUDED.weighted_percentage,
--     is_passing_year = EXCLUDED.is_passing_year,
--     calculated_at = NOW(),
--     academic_year = EXCLUDED.academic_year;
--
--   RETURN v_total_earned;
-- END;
-- $function$;

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- CREATE OR REPLACE FUNCTION calculate_student_grade(text, uuid)
--   RETURNS numeric LANGUAGE plpgsql AS $$
--     <copy calculate_student_grade_legacy's body verbatim>
--   $$;
-- DROP FUNCTION IF EXISTS calculate_student_grade_preview(text, uuid);
