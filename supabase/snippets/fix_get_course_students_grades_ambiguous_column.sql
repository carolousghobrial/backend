-- ================================================================
-- Fix "column reference category_name is ambiguous" in
-- get_course_students_grades
-- ================================================================
-- RETURNS TABLE(... category_name text ...) auto-declares category_name
-- (and every other output column) as a PL/pgSQL variable in the function's
-- own scope. The final ORDER BY at the bottom of the original function
-- referenced category_name directly, which Postgres can't disambiguate
-- from the query's own output column of the same name -- same latent risk
-- applies to student_last_name/student_first_name, even though only
-- category_name got flagged in practice.
--
-- Fix: wrap the whole UNION ALL in a subquery and order by the subquery's
-- columns explicitly. No behavior change otherwise -- every SELECT branch
-- and the CASE-based category ordering are identical to the original.
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_course_students_grades(p_course_id uuid)
 RETURNS TABLE(student_id text, student_first_name text, student_last_name text, student_email text, category_name text, earned_points numeric, possible_points numeric, percentage numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT results.student_id, results.student_first_name, results.student_last_name,
         results.student_email, results.category_name, results.earned_points,
         results.possible_points, results.percentage
  FROM (
    SELECT
      sfg.student_id,
      p.first_name as student_first_name,
      p.last_name as student_last_name,
      p.email as student_email,
      'Hymns'::TEXT as category_name,
      sfg.hymns_earned_points as earned_points,
      sfg.hymns_possible_points as possible_points,
      CASE
        WHEN sfg.hymns_possible_points > 0 THEN
          ROUND((sfg.hymns_earned_points / sfg.hymns_possible_points * 100), 2)
        ELSE 0.00
      END as percentage
    FROM ds_student_final_grades sfg
    JOIN ds_student_enrollment se ON sfg.student_id = se.student_id AND se.course_id = sfg.course_id
    JOIN profiles p ON se.student_id = p.portal_id
    WHERE sfg.course_id = p_course_id
      AND se.is_active = true

    UNION ALL

    SELECT
      sfg.student_id,
      p.first_name,
      p.last_name,
      p.email,
      'Rituals'::TEXT,
      sfg.rituals_earned_points,
      sfg.rituals_possible_points,
      CASE
        WHEN sfg.rituals_possible_points > 0 THEN
          ROUND((sfg.rituals_earned_points / sfg.rituals_possible_points * 100), 2)
        ELSE 0.00
      END
    FROM ds_student_final_grades sfg
    JOIN ds_student_enrollment se ON sfg.student_id = se.student_id AND se.course_id = sfg.course_id
    JOIN profiles p ON se.student_id = p.portal_id
    WHERE sfg.course_id = p_course_id
      AND se.is_active = true

    UNION ALL

    SELECT
      sfg.student_id,
      p.first_name,
      p.last_name,
      p.email,
      'Coptic'::TEXT,
      sfg.coptic_earned_points,
      sfg.coptic_possible_points,
      CASE
        WHEN sfg.coptic_possible_points > 0 THEN
          ROUND((sfg.coptic_earned_points / sfg.coptic_possible_points * 100), 2)
        ELSE 0.00
      END
    FROM ds_student_final_grades sfg
    JOIN ds_student_enrollment se ON sfg.student_id = se.student_id AND se.course_id = sfg.course_id
    JOIN profiles p ON se.student_id = p.portal_id
    WHERE sfg.course_id = p_course_id
      AND se.is_active = true

    UNION ALL

    SELECT
      sfg.student_id,
      p.first_name,
      p.last_name,
      p.email,
      'Memorization'::TEXT,
      sfg.memorization_earned_points,
      sfg.memorization_possible_points,
      CASE
        WHEN sfg.memorization_possible_points > 0 THEN
          ROUND((sfg.memorization_earned_points / sfg.memorization_possible_points * 100), 2)
        ELSE 0.00
      END
    FROM ds_student_final_grades sfg
    JOIN ds_student_enrollment se ON sfg.student_id = se.student_id AND se.course_id = sfg.course_id
    JOIN profiles p ON se.student_id = p.portal_id
    WHERE sfg.course_id = p_course_id
      AND se.is_active = true

    UNION ALL

    SELECT
      sfg.student_id,
      p.first_name,
      p.last_name,
      p.email,
      'Altar Responses'::TEXT,
      sfg.altar_responses_earned_points,
      sfg.altar_responses_possible_points,
      CASE
        WHEN sfg.altar_responses_possible_points > 0 THEN
          ROUND((sfg.altar_responses_earned_points / sfg.altar_responses_possible_points * 100), 2)
        ELSE 0.00
      END
    FROM ds_student_final_grades sfg
    JOIN ds_student_enrollment se ON sfg.student_id = se.student_id AND se.course_id = sfg.course_id
    JOIN profiles p ON se.student_id = p.portal_id
    WHERE sfg.course_id = p_course_id
      AND se.is_active = true

    UNION ALL

    SELECT
      sfg.student_id,
      p.first_name,
      p.last_name,
      p.email,
      'Behavior'::TEXT,
      sfg.behavior_earned_points,
      sfg.behavior_possible_points,
      CASE
        WHEN sfg.behavior_possible_points > 0 THEN
          ROUND((sfg.behavior_earned_points / sfg.behavior_possible_points * 100), 2)
        ELSE 0.00
      END
    FROM ds_student_final_grades sfg
    JOIN ds_student_enrollment se ON sfg.student_id = se.student_id AND se.course_id = sfg.course_id
    JOIN profiles p ON se.student_id = p.portal_id
    WHERE sfg.course_id = p_course_id
      AND se.is_active = true

    UNION ALL

    SELECT
      sfg.student_id,
      p.first_name,
      p.last_name,
      p.email,
      'Attendance'::TEXT,
      sfg.attendance_earned_points,
      sfg.attendance_possible_points,
      CASE
        WHEN sfg.attendance_possible_points > 0 THEN
          ROUND((sfg.attendance_earned_points / sfg.attendance_possible_points * 100), 2)
        ELSE 0.00
      END
    FROM ds_student_final_grades sfg
    JOIN ds_student_enrollment se ON sfg.student_id = se.student_id AND se.course_id = sfg.course_id
    JOIN profiles p ON se.student_id = p.portal_id
    WHERE sfg.course_id = p_course_id
      AND se.is_active = true

    UNION ALL

    -- Extra Credit: Only adds to earned, NOT to possible (bonus points)
    SELECT
      sfg.student_id,
      p.first_name,
      p.last_name,
      p.email,
      'Extra Credit'::TEXT,
      sfg.extra_credit_earned_points,
      0.00::DECIMAL(10,2) as possible_points,  -- No "possible" for extra credit
      0.00::DECIMAL(5,2) as percentage         -- N/A for extra credit
    FROM ds_student_final_grades sfg
    JOIN ds_student_enrollment se ON sfg.student_id = se.student_id AND se.course_id = sfg.course_id
    JOIN profiles p ON se.student_id = p.portal_id
    WHERE sfg.course_id = p_course_id
      AND se.is_active = true

    UNION ALL

    -- TOTAL row showing overall grade per student
    SELECT
      sfg.student_id,
      p.first_name,
      p.last_name,
      p.email,
      'TOTAL'::TEXT,
      sfg.total_earned_points,
      sfg.total_possible_points,
      sfg.weighted_percentage
    FROM ds_student_final_grades sfg
    JOIN ds_student_enrollment se ON sfg.student_id = se.student_id AND se.course_id = sfg.course_id
    JOIN profiles p ON se.student_id = p.portal_id
    WHERE sfg.course_id = p_course_id
      AND se.is_active = true
  ) AS results

  -- Order by student name, then by category in logical order
  ORDER BY
    results.student_last_name,
    results.student_first_name,
    CASE results.category_name
      WHEN 'Hymns' THEN 1
      WHEN 'Rituals' THEN 2
      WHEN 'Coptic' THEN 3
      WHEN 'Memorization' THEN 4
      WHEN 'Altar Responses' THEN 5
      WHEN 'Behavior' THEN 6
      WHEN 'Attendance' THEN 7
      WHEN 'Extra Credit' THEN 8
      WHEN 'TOTAL' THEN 9
      ELSE 10
    END;
END;
$function$
