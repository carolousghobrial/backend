

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "notifications";


ALTER SCHEMA "notifications" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "sundaySchool";


ALTER SCHEMA "sundaySchool" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."ServicesAvailable" AS ENUM (
    'ss_preK1',
    'ss_prek2',
    'ss_kg1',
    'ss_kg2',
    'ss_first',
    'ss_second',
    'ss_third',
    'ss_fourth',
    'ss_fifth_b',
    'ss_sixth_b',
    'ss_seventh_b',
    'ss_eighth_b',
    'ss_fifth_g',
    'ss_sixth_g',
    'ss_seventh_g',
    'ss_eighth_g',
    'preservants',
    'eleventh_twelvth',
    'holy_family_meeting',
    'servantsMeeting',
    'youth_meeting',
    'preschool_choir',
    'elementary_choir',
    'middle_choir',
    'youth_choir',
    'adult_choir',
    'lost_sheep',
    'visitation',
    'av_service',
    'community_service',
    'kitchen_service',
    'van_maintenance',
    'church_cleaning',
    'deacons',
    'orban',
    'organization',
    'bookstore',
    'church_maintenance',
    'arabic_biblestudy',
    'church',
    'ds_level_alpha',
    'ds_level_beta',
    'ds_level_1',
    'ds_level_2',
    'ds_level_3',
    'ds_level_4',
    'ds_level_5',
    'ds_level_6',
    'ds_level_7',
    'ds_level_8',
    'ds_level_9',
    'ds_level_10',
    'ds_level_graduates'
);


ALTER TYPE "public"."ServicesAvailable" OWNER TO "postgres";


CREATE TYPE "public"."daysOfWeek" AS ENUM (
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday'
);


ALTER TYPE "public"."daysOfWeek" OWNER TO "postgres";


CREATE TYPE "public"."ds_grade_type" AS ENUM (
    'hymn_test',
    'rituals_test',
    'coptic_test',
    'memorization_test',
    'alter_responses_test',
    'behavior'
);


ALTER TYPE "public"."ds_grade_type" OWNER TO "postgres";


CREATE TYPE "public"."roles" AS ENUM (
    'congregant',
    'sunday_school_student',
    'servant',
    'sunday_school_coordinator',
    'deacon_school_student',
    'deacon_school_teacher',
    'deacon_school_coordinator',
    'coordinator',
    'priest',
    'member'
);


ALTER TYPE "public"."roles" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_student_grade"("p_student_id" "text", "p_course_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql"
    AS $$
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
  /* -------------------------------------------
     CATEGORY SCORES
     - Regular items: add to both earned + possible
     - Extra credit items: add to earned ONLY (not possible)
  ------------------------------------------- */
  FOR category_rec IN
    SELECT
      c.category_name,

      -- Earned points from NON-extra-credit items only
      COALESCE(SUM(
        CASE
          WHEN COALESCE(ai.is_extra_credit, false) = false
          THEN s.points_earned
          ELSE 0
        END
      ), 0) AS earned_points,

      -- Possible points from NON-extra-credit items only
      COALESCE(SUM(
        CASE
          WHEN COALESCE(ai.is_extra_credit, false) = false
          THEN s.points_possible
          ELSE 0
        END
      ), 0) AS possible_points,

      -- Extra credit: ONLY count points_earned (NOT points_possible)
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
    -- Accumulate extra credit from ALL categories (this was the bug!)
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
        -- Any other category - still accumulate extra credit
        NULL;
    END CASE;
  END LOOP;

  /* -------------------------------------------
     ATTENDANCE
  ------------------------------------------- */
  SELECT COALESCE(attendance_score, 0)
  INTO v_attendance_earned
  FROM ds_student_attendance_scores
  WHERE student_id = p_student_id
    AND course_id = p_course_id;

  /* -------------------------------------------
     BEHAVIOR
  ------------------------------------------- */
  SELECT COALESCE(behavior_score, 0)
  INTO v_behavior_earned
  FROM ds_student_behavior_scores
  WHERE student_id = p_student_id
    AND course_id = p_course_id;

  /* -------------------------------------------
     TOTALS
     - Extra credit adds to earned but NOT to possible
     - This allows students to exceed 100%
  ------------------------------------------- */
  v_total_earned :=
    v_hymns_earned +
    v_rituals_earned +
    v_coptic_earned +
    v_memorization_earned +
    v_altar_responses_earned +
    v_behavior_earned +
    v_attendance_earned +
    v_extra_credit_earned;  -- Extra credit ONLY adds to earned

  v_total_possible :=
    v_hymns_possible +
    v_rituals_possible +
    v_coptic_possible +
    v_memorization_possible +
    v_altar_responses_possible +
    v_behavior_possible +
    v_attendance_possible;
    -- NO extra credit added to possible!

  /* -------------------------------------------
     FINAL PERCENTAGE
     - Can exceed 100% due to extra credit
  ------------------------------------------- */
  IF v_total_possible > 0 THEN
    v_weighted_percentage := (v_total_earned / v_total_possible) * 100;
  ELSE
    v_weighted_percentage := 0;
  END IF;

  v_is_passing := v_weighted_percentage >= 60;

  /* -------------------------------------------
     UPSERT FINAL GRADE
  ------------------------------------------- */
  INSERT INTO ds_student_final_grades (
    student_id,
    course_id,
    hymns_earned_points,
    hymns_possible_points,
    coptic_earned_points,
    coptic_possible_points,
    rituals_earned_points,
    rituals_possible_points,
    memorization_earned_points,
    memorization_possible_points,
    altar_responses_earned_points,
    altar_responses_possible_points,
    behavior_earned_points,
    behavior_possible_points,
    attendance_earned_points,
    attendance_possible_points,
    extra_credit_earned_points,
    total_earned_points,
    total_possible_points,
    weighted_percentage,
    is_passing_year,
    calculated_at
  )
  VALUES (
    p_student_id,
    p_course_id,
    v_hymns_earned,
    v_hymns_possible,
    v_coptic_earned,
    v_coptic_possible,
    v_rituals_earned,
    v_rituals_possible,
    v_memorization_earned,
    v_memorization_possible,
    v_altar_responses_earned,
    v_altar_responses_possible,
    v_behavior_earned,
    v_behavior_possible,
    v_attendance_earned,
    v_attendance_possible,
    v_extra_credit_earned,
    v_total_earned,
    v_total_possible,
    v_weighted_percentage,
    v_is_passing,
    NOW()
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
    calculated_at = NOW();

  RETURN v_total_earned;
END;
$$;


ALTER FUNCTION "public"."calculate_student_grade"("p_student_id" "text", "p_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_folders_with_counts"() RETURNS TABLE("id" "uuid", "folder_name" character varying, "description" "text", "color" character varying, "icon" character varying, "sort_order" integer, "hymn_count" bigint, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.folder_name,
        f.description,
        f.color,
        f.icon,
        f.sort_order,
        COUNT(fi.id) as hymn_count,
        f.created_at,
        f.updated_at
    FROM hymn_folders f
    LEFT JOIN hymn_folder_items fi ON f.id = fi.folder_id
    GROUP BY f.id, f.folder_name, f.description, f.color, f.icon, f.sort_order, f.created_at, f.updated_at
    ORDER BY f.sort_order;
END;
$$;


ALTER FUNCTION "public"."get_all_folders_with_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_students_scores_by_course"("p_course_id" "uuid") RETURNS TABLE("score_id" "uuid", "student_id" "text", "course_id" "uuid", "item_id" "uuid", "scored_date" timestamp with time zone, "points_earned" numeric, "points_possible" numeric, "item_name" "text", "item_reference" "text", "reference_id" "text", "category_id" "uuid", "category_name" "text", "weight_percentage" numeric)
    LANGUAGE "plpgsql"
    AS $$

BEGIN
  RETURN QUERY

  -- Regular student scores
  SELECT 
      s.score_id,
      s.student_id,
      s.course_id,
      s.item_id,
      s.scored_date,
      s.points_earned,
      s.points_possible,
      ai.item_name,
      ai.item_reference,
      ai.reference_id,
      gc.category_id,
      gc.category_name,
      gc.weight_percentage
  FROM ds_student_scores s
  JOIN ds_assessment_items ai 
      ON s.item_id = ai.item_id
  JOIN ds_grading_categories gc 
      ON ai.category_id = gc.category_id
  WHERE s.course_id = p_course_id

  UNION ALL

  -- Attendance as its own row
  SELECT 
      sa.attendance_score_id,
      sa.student_id,
      sa.course_id,
      NULL AS item_id,
      sa.updated_at AS scored_date,
      sa.attendance_score AS points_earned,
      100 AS points_possible,
      'Attendance' AS item_name,
      NULL AS item_reference,
      NULL AS reference_id,
      gc.category_id,
      gc.category_name,
      gc.weight_percentage
  FROM ds_student_attendance_scores sa
  JOIN ds_grading_categories gc 
      ON gc.category_name = 'attendance'
  WHERE sa.course_id = p_course_id

  UNION ALL

  -- Behavior as its own row
  SELECT 
      sb.behavior_score_id,
      sb.student_id,
      sb.course_id,
      NULL AS item_id,
      sb.updated_at AS scored_date,
      sb.behavior_score AS points_earned,
      100 AS points_possible,
      'Behavior' AS item_name,
      NULL AS item_reference,
      NULL AS reference_id,
      gc.category_id,
      gc.category_name,
      gc.weight_percentage
  FROM ds_student_behavior_scores sb
  JOIN ds_grading_categories gc 
      ON gc.category_name = 'behavior'
  WHERE sb.course_id = p_course_id

  ORDER BY scored_date DESC NULLS LAST;
END;

$$;


ALTER FUNCTION "public"."get_all_students_scores_by_course"("p_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_user_emails"() RETURNS TABLE("email" "text")
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
    SELECT email::text
    FROM auth.users
    LIMIT 10000;
$$;


ALTER FUNCTION "public"."get_all_user_emails"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_attendance_by_date_and_service"("p_date" "date", "p_service_id" "text") RETURNS TABLE("id" bigint, "portal_id" "text", "date" "date", "timestamp" timestamp with time zone, "service_id" "text", "taken_by" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "name" "text", "first_name" "text", "last_name" "text", "email" "text", "cellphone" "text", "dob" "date", "family_id" "text", "family_role" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.portal_id,
        a.date,
        a."timestamp",  -- Quote here too
        a.service_id,
        a.taken_by,
        a.created_at,
        a.updated_at,
        -- Construct full name from profiles
        CASE 
            WHEN p.first_name IS NOT NULL AND p.last_name IS NOT NULL 
            THEN TRIM(CONCAT(p.first_name, ' ', p.last_name))
            WHEN p.first_name IS NOT NULL 
            THEN p.first_name
            WHEN p.last_name IS NOT NULL 
            THEN p.last_name
            ELSE 'Unknown User'
        END AS name,
        p.first_name,
        p.last_name,
        p.email,
        p.cellphone,
        p.dob,
        p.family_id,
        p.family_role
    FROM attendance a
    LEFT JOIN profiles p ON a.portal_id = p.portal_id
    WHERE a.date = p_date AND a.service_id = p_service_id
    ORDER BY a."timestamp" DESC;  -- Quote here as well
END;
$$;


ALTER FUNCTION "public"."get_attendance_by_date_and_service"("p_date" "date", "p_service_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_calendar_by_course_and_date_range"("p_course_id" "uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS TABLE("week_num" bigint, "calendar_day" "date", "hymn_id" bigint, "courses_id" "uuid"[], "others_id" bigint, "others_tablename" "text", "teacher_id" "text", "hymn_name" "text", "content_type" "text", "content_name" "text", "content_id" bigint)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_start_date DATE := COALESCE(p_start_date, date_trunc('week', current_date)::DATE);
    v_end_date DATE := COALESCE(p_end_date, (date_trunc('week', current_date) + interval '7 days')::DATE);
BEGIN
    RETURN QUERY

    -- Ritual lessons
    SELECT 
        dc.week_num,
        dc.calendar_day,
        dc.hymn_id,
        dc.courses_id,
        dc.others_id,
        dc.others_tablename,
        dc.teacher_id,
        dh.hymn_name,
        'ritual_lessons'::TEXT AS content_type,
        rl.title AS content_name,
        rl.id AS content_id
    FROM ds_calendar_week dc
    LEFT JOIN deacons_school_hymns dh ON dc.hymn_id = dh.id
    LEFT JOIN ds_rituals_lesson_by_level rl 
        ON dc.others_id = rl.id
        AND dc.others_tablename = 'ds_rituals_lesson_by_level'
        AND rl.title IS NOT NULL
    WHERE 
        p_course_id = ANY(dc.courses_id)
        AND dc.calendar_day >= v_start_date
        AND dc.calendar_day < v_end_date

    UNION ALL

    -- Altar responses
    SELECT 
        dc.week_num,
        dc.calendar_day,
        dc.hymn_id,
        dc.courses_id,
        dc.others_id,
        dc.others_tablename,
        dc.teacher_id,
        dh.hymn_name,
        'altar_responses'::TEXT AS content_type,
        ar.response_name AS content_name,
        ar.id AS content_id
    FROM ds_calendar_week dc
    LEFT JOIN deacons_school_hymns dh ON dc.hymn_id = dh.id
    LEFT JOIN deacons_school_altar_responses ar
        ON dc.others_id = ar.id
        AND dc.others_tablename = 'deacons_school_altar_responses'
        AND ar.response_name IS NOT NULL
    WHERE 
        p_course_id = ANY(dc.courses_id)
        AND dc.calendar_day >= v_start_date
        AND dc.calendar_day < v_end_date

    UNION ALL

    -- Memorization
    SELECT 
        dc.week_num,
        dc.calendar_day,
        dc.hymn_id,
        dc.courses_id,
        dc.others_id,
        dc.others_tablename,
        dc.teacher_id,
        dh.hymn_name,
        'memorization'::TEXT AS content_type,
        mem.title AS content_name,
        mem.id AS content_id
    FROM ds_calendar_week dc
    LEFT JOIN deacons_school_hymns dh ON dc.hymn_id = dh.id
    LEFT JOIN deacons_school_memorization mem
        ON dc.others_id = mem.id
        AND dc.others_tablename = 'deacons_school_memorization'
        AND mem.title IS NOT NULL
    WHERE 
        p_course_id = ANY(dc.courses_id)
        AND dc.calendar_day >= v_start_date
        AND dc.calendar_day < v_end_date

    UNION ALL

    -- Coptic lessons
    SELECT 
        dc.week_num,
        dc.calendar_day,
        dc.hymn_id,
        dc.courses_id,
        dc.others_id,
        dc.others_tablename,
        dc.teacher_id,
        dh.hymn_name,
        'coptic_lessons'::TEXT AS content_type,
        cl.title AS content_name,
        cl.id AS content_id
    FROM ds_calendar_week dc
    LEFT JOIN deacons_school_hymns dh ON dc.hymn_id = dh.id
    LEFT JOIN ds_coptic_lesson_by_level cl
        ON dc.others_id = cl.id
        AND dc.others_tablename = 'ds_coptic_lesson_by_level'
        AND cl.title IS NOT NULL
    WHERE 
        p_course_id = ANY(dc.courses_id)
        AND dc.calendar_day >= v_start_date
        AND dc.calendar_day < v_end_date

    ORDER BY calendar_day ASC;

END;
$$;


ALTER FUNCTION "public"."get_calendar_by_course_and_date_range"("p_course_id" "uuid", "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_course_students_grades"("p_course_id" "uuid") RETURNS TABLE("student_id" "text", "student_first_name" "text", "student_last_name" "text", "student_email" "text", "category_name" "text", "earned_points" numeric, "possible_points" numeric, "percentage" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
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

  -- Order by student name, then by category in logical order
  ORDER BY 
    student_last_name, 
    student_first_name,
    CASE category_name
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
$$;


ALTER FUNCTION "public"."get_course_students_grades"("p_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_week_calendar_by_course"("p_course_id" "uuid") RETURNS TABLE("week_num" bigint, "calendar_day" "date", "hymn_id" bigint, "courses_id" "uuid"[], "others_id" bigint, "others_tablename" "text", "hymn_name" "text", "content_type" "text", "content_name" "text", "content_id" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
 -- Ritual Lessons
    SELECT 
        dc.week_num,
        dc.calendar_day,
        dc.hymn_id,
        dc.courses_id,
        dc.others_id,
        dc.others_tablename,
        dh.hymn_name,
        'ritual_lessons'::TEXT AS content_type,
        rl.title AS content_name,
        rl.id AS content_id
    FROM ds_calendar_week dc
    LEFT JOIN deacons_school_hymns dh ON dc.hymn_id = dh.id
    LEFT JOIN ds_rituals_lesson_by_level rl 
        ON dc.others_id = rl.id 
        AND dc.others_tablename = 'ds_rituals_lesson_by_level'
        AND dc.level NOT IN ('ds_level_9', 'ds_level_10', 'ds_level_graduates')
        AND rl.title IS NOT NULL
    WHERE (
        p_course_id = ANY(dc.courses_id)
      
    )
    AND dc.calendar_day >= date_trunc('week', current_date)
    AND dc.calendar_day < date_trunc('week', current_date) + interval '7 days'

    UNION ALL

    -- Altar Responses
    SELECT 
        dc.week_num,
        dc.calendar_day,
        dc.hymn_id,
        dc.courses_id,
        dc.others_id,
        dc.others_tablename,
        dh.hymn_name,
        'altar_responses'::TEXT AS content_type,
        ar.response_name AS content_name,
        ar.id AS content_id
    FROM ds_calendar_week dc
    LEFT JOIN deacons_school_hymns dh ON dc.hymn_id = dh.id
    LEFT JOIN deacons_school_altar_responses ar 
        ON dc.others_id = ar.id 
        AND dc.others_tablename = 'deacons_school_altar_responses'
        AND dc.level NOT IN ('ds_level_9', 'ds_level_10', 'ds_level_graduates')
        AND ar.response_name IS NOT NULL
    WHERE (
        p_course_id = ANY(dc.courses_id)
    )
    AND dc.calendar_day >= date_trunc('week', current_date)
    AND dc.calendar_day < date_trunc('week', current_date) + interval '7 days'

    UNION ALL

    -- Memorization
    SELECT 
        dc.week_num,
        dc.calendar_day,
        dc.hymn_id,
        dc.courses_id,
        dc.others_id,
        dc.others_tablename,
        dh.hymn_name,
        'memorization'::TEXT AS content_type,
        mem.title AS content_name,
        mem.id AS content_id
    FROM ds_calendar_week dc
    LEFT JOIN deacons_school_hymns dh ON dc.hymn_id = dh.id
    LEFT JOIN deacons_school_memorization mem 
        ON dc.others_id = mem.id 
        AND dc.others_tablename = 'deacons_school_memorization'
        AND dc.level NOT IN ('ds_level_9', 'ds_level_10', 'ds_level_graduates')
        AND mem.title IS NOT NULL
    WHERE (
        p_course_id = ANY(dc.courses_id)
    )
    AND dc.calendar_day >= date_trunc('week', current_date)
    AND dc.calendar_day < date_trunc('week', current_date) + interval '7 days'

    UNION ALL

    -- Coptic Lessons
    SELECT 
        dc.week_num,
        dc.calendar_day,
        dc.hymn_id,
        dc.courses_id,
        dc.others_id,
        dc.others_tablename,
        dh.hymn_name,
        'coptic_lessons'::TEXT AS content_type,
        cl.title AS content_name,
        cl.id AS content_id
    FROM ds_calendar_week dc
    LEFT JOIN deacons_school_hymns dh ON dc.hymn_id = dh.id
     LEFT JOIN ds_coptic_lesson_by_level cl 
        ON dc.others_id = cl.id 
        AND dc.others_tablename = 'ds_coptic_lesson_by_level'
        AND dc.level NOT IN ('ds_level_9', 'ds_level_10', 'ds_level_graduates')
        AND cl.title IS NOT NULL
    WHERE (
        p_course_id = ANY(dc.courses_id)
    )
    AND dc.calendar_day >= date_trunc('week', current_date)
    AND dc.calendar_day < date_trunc('week', current_date) + interval '7 days'

    ORDER BY calendar_day ASC;
END;
$$;


ALTER FUNCTION "public"."get_current_week_calendar_by_course"("p_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_deacon_school_teachers"() RETURNS TABLE("profile_id" "text", "first_name" "text", "last_name" "text", "cellphone" "text", "dob" "date", "email" "text", "course_id" "uuid", "class_name" "text", "level" "text", "teacher_id" "uuid")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.portal_id AS profile_id, 
        p.first_name, 
        p.last_name,
        p.cellphone, 
        p.dob,
        p.email, 
        c.course_id,
        c.class_name,
        c.level,
        dct.course_teacher_id
    FROM profiles p 
    JOIN ds_course_teachers dct 
        ON p.portal_id = dct.teacher_id
    JOIN ds_courses c 
        ON dct.course_id = c.course_id
    ORDER BY c.level, c.class_name, dct.assigned_date DESC;
END;
$$;


ALTER FUNCTION "public"."get_deacon_school_teachers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_deacons_school_extras_by_level"("level_param" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$BEGIN
    RETURN jsonb_build_object(
        'hymns', (SELECT jsonb_agg(h) FROM deacons_school_hymns h WHERE h.level_hymn_in = level_param),
        'deacons_school_altar_responses', (SELECT jsonb_agg(a) FROM deacons_school_altar_responses a WHERE a.level = level_param),
        'deacons_school_memorization', (SELECT jsonb_agg(m) FROM deacons_school_memorization m WHERE m.level = level_param),
        'ds_rituals_lesson_by_level', (SELECT jsonb_agg(r) FROM ds_rituals_lesson_by_level r WHERE r.level = level_param),
        'ds_coptic_lesson_by_level', (SELECT jsonb_agg(c) FROM ds_coptic_lesson_by_level c WHERE c.level = level_param)

    );
END;$$;


ALTER FUNCTION "public"."get_deacons_school_extras_by_level"("level_param" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_ds_student_courses_by_portal_id"("p_user_id" "text") RETURNS TABLE("portal_id" "text", "first_name" "text", "last_name" "text", "course_id" "uuid", "class_name" "text", "level" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.portal_id,
        p.first_name,
        p.last_name,
        d.course_id,
        dc.class_name,
        dc.level
    FROM profiles p
    JOIN ds_student_enrollment d ON p.portal_id = d.student_id
    JOIN ds_courses dc ON dc.course_id = d.course_id
    WHERE p.portal_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."get_ds_student_courses_by_portal_id"("p_user_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_ds_teacher_courses_by_portal_id"("p_user_id" "text") RETURNS TABLE("portal_id" "text", "first_name" "text", "last_name" "text", "course_id" "uuid", "class_name" "text", "level" "text")
    LANGUAGE "plpgsql"
    AS $$BEGIN
    RETURN QUERY
    SELECT 
        p.portal_id,
        p.first_name,
        p.last_name,
        d.course_id,
        dc.class_name,
        dc.level
    FROM profiles p
    JOIN ds_course_teachers d ON p.portal_id = d.teacher_id
    JOIN ds_courses dc ON dc.course_id = d.course_id
    WHERE         (p_user_id = '5769' OR p.portal_id = p_user_id);
END;$$;


ALTER FUNCTION "public"."get_ds_teacher_courses_by_portal_id"("p_user_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_ds_teachers_by_course"("p_course_id" "uuid") RETURNS TABLE("profile_id" "text", "first_name" "text", "last_name" "text", "cellphone" "text", "dob" "date", "email" "text", "course_id" "uuid", "class_name" "text", "level" "text", "teacher_id" "text", "assigned_date" "date")
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.portal_id AS profile_id, 
        p.first_name, 
        p.last_name,
        p.cellphone, 
        p.dob,
        p.email, 
        c.course_id,
        c.class_name,
        c.level,
        dct.teacher_id,
        dct.assigned_date
    FROM profiles p 
    JOIN ds_course_teachers dct 
        ON p.portal_id = dct.teacher_id
    JOIN ds_courses c 
        ON dct.course_id = c.course_id
    WHERE c.course_id = p_course_id
    ORDER BY c.level, c.class_name, dct.assigned_date DESC;
END;
$$;


ALTER FUNCTION "public"."get_ds_teachers_by_course"("p_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_family_children"("portal_id_in" "text"[]) RETURNS TABLE("id" "uuid", "portal_id" "text", "first_name" "text", "last_name" "text", "dob" "date", "family_id" "text", "email" "text", "cellphone" "text", "family_role" "text")
    LANGUAGE "sql"
    AS $$SELECT DISTINCT
  id,
  portal_id,
  first_name,
  last_name,
  dob,
  family_id,
  email,
  cellphone,
  family_role
FROM (

  /* Adults */
  SELECT 
    fm.id,
    fm.portal_id,
    fm.first_name,
    fm.last_name,
    fm.dob,
    fm.family_id,
    fm.email,
    fm.cellphone,
    fm.family_role
  FROM profiles fm
  WHERE 
    fm.portal_id = ANY (portal_id_in)


  UNION ALL

  /* Children under 18 ONLY if linked to a qualifying adult */
  SELECT 
    c.id,
    c.portal_id,
    c.first_name,
    c.last_name,
    c.dob,
    c.family_id,
    c.email,
    c.cellphone,
    c.family_role
  FROM profiles adult
  JOIN profiles c 
    ON adult.family_id = c.family_id
  WHERE 
    adult.portal_id = ANY (portal_id_in)
    AND adult.family_role IN (
      'HEAD_OF_HOUSEHOLD',
      'HEAD OF HOUSE',
      'SPOUSE',
      'WIFE'
    )
    AND c.family_role IN ('SON', 'DAUGHTER')
    AND c.dob > current_date - interval '18 years'

) x
ORDER BY first_name;$$;


ALTER FUNCTION "public"."get_family_children"("portal_id_in" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_item_points"("p_item_reference" character varying, "p_reference_id" character varying) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_points INTEGER := 100; -- default
BEGIN
  -- Only hymns table has points column, others default to 100
  CASE p_item_reference
    WHEN 'deacons_school_hymns' THEN
      SELECT COALESCE(points, 100) 
      INTO v_points
      FROM deacons_school_hymns 
      WHERE id = p_reference_id::INTEGER;
    
    ELSE
      v_points := 100; -- default 100 points for rituals, memorization, altar_responses, etc.
  END CASE;
  
  RETURN COALESCE(v_points, 100);
END;
$$;


ALTER FUNCTION "public"."get_item_points"("p_item_reference" character varying, "p_reference_id" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profile_all_roles"("p_user_id" "uuid") RETURNS TABLE("portal_id" "text", "first_name" "text", "last_name" "text", "role_id" "text", "role_name" "text", "service_id" "text", "service_title" "text", "course_id" "text", "source_type" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY

    -- Service Roles
    SELECT 
        p.portal_id,
        p.first_name,
        p.last_name,
        r.role_id::text,
        r.role_name,
        v.service_id::text,
        v.service_title,
        NULL::text AS course_id,
        'service_role' AS source_type
    FROM profiles p
    JOIN user_service_roles s ON p.id = s.user_id
    JOIN roles_table r ON s.role_id = r.role_id
    JOIN services_table v ON s.service_id = v.service_id
    WHERE p.id = p_user_id

    UNION ALL

    -- Course Teacher Roles
    SELECT 
        p.portal_id,
        p.first_name,
        p.last_name,
        r.role_id::text,
        r.role_name,
        NULL::text AS service_id,
        NULL::text AS service_title,
        d.course_id::text,
        'course_teacher' AS source_type
    FROM profiles p
    JOIN ds_course_teachers d ON p.portal_id = d.teacher_id
    JOIN ds_courses dc ON dc.course_id = d.course_id
    JOIN roles_table r ON r.role_id = d.role
    WHERE p.id = p_user_id

    UNION ALL

    -- Course Student Roles
    SELECT 
        p.portal_id,
        p.first_name,
        p.last_name,
        r.role_id::text,
        r.role_name,
        NULL::text AS service_id,
        NULL::text AS service_title,
        ds.course_id::text,
        'course_student' AS source_type
    FROM profiles p
    JOIN ds_student_enrollment ds ON p.portal_id = ds.student_id
    JOIN ds_courses dc ON dc.course_id = ds.course_id
    JOIN roles_table r ON r.role_id = ds.role
    WHERE p.id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."get_profile_all_roles"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_service_members_teachers_coordinators"("p_service_id" "text") RETURNS TABLE("id" bigint, "portal_id" "text", "service_id" "text", "role_id" "public"."roles", "service_title" "text", "description" "text", "first_name" "text", "last_name" "text", "email" "text", "cellphone" "text", "dob" "date", "family_id" "text", "family_role" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.portal_id,
        a.service_id,
        a.role_id,
                st.service_title,
        st.description,
p.first_name, 
p.last_name,

        p.email,
        p.cellphone,
        p.dob,
        p.family_id,
        p.family_role
    FROM user_service_roles a
    LEFT JOIN profiles p ON a.portal_id = p.portal_id
    LEFT JOIN services_table st ON a.service_id = st.service_id
    WHERE  a.service_id = p_service_id;
END;
$$;


ALTER FUNCTION "public"."get_service_members_teachers_coordinators"("p_service_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_all_scores"("p_student_id" "text", "p_course_id" "uuid") RETURNS TABLE("score_id" "uuid", "student_id" "text", "course_id" "uuid", "item_id" "uuid", "scored_date" timestamp with time zone, "points_earned" numeric, "points_possible" numeric, "item_name" "text", "item_reference" "text", "reference_id" "text", "category_id" "uuid", "category_name" "text", "weight_percentage" numeric)
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
  RETURN QUERY

  -- Regular student scores
  SELECT 
      s.score_id,
      s.student_id,
      s.course_id,
      s.item_id,
      s.scored_date,
      s.points_earned,
      s.points_possible,
      ai.item_name,
      ai.item_reference,
      ai.reference_id,
      gc.category_id,
      gc.category_name,
      gc.weight_percentage
  FROM ds_student_scores s
  JOIN ds_assessment_items ai 
      ON s.item_id = ai.item_id
  JOIN ds_grading_categories gc 
      ON ai.category_id = gc.category_id
  WHERE s.student_id = p_student_id
    AND s.course_id = p_course_id

  UNION ALL

  -- Attendance as its own row
  SELECT 
      sa.attendance_score_id,
      sa.student_id,
      sa.course_id,
      NULL AS item_id,
      sa.updated_at AS scored_date,
      sa.attendance_score AS points_earned,
      100 AS points_possible,
      'Attendance' AS item_name,
      NULL AS item_reference,
      NULL AS reference_id,
      gc.category_id,
      gc.category_name,
      gc.weight_percentage
  FROM ds_student_attendance_scores sa
  JOIN ds_grading_categories gc 
      ON gc.category_name = 'attendance'
  WHERE sa.student_id = p_student_id
    AND sa.course_id = p_course_id

  UNION ALL

  -- Behavior as its own row
  SELECT 
      sb.behavior_score_id,
      sb.student_id,
      sb.course_id,
      NULL AS item_id,
      sb.updated_at AS scored_date,
      sb.behavior_score AS points_earned,
      100 AS points_possible,
      'Behavior' AS item_name,
      NULL AS item_reference,
      NULL AS reference_id,
      gc.category_id,
      gc.category_name,
      gc.weight_percentage
  FROM ds_student_behavior_scores sb
  JOIN ds_grading_categories gc 
      ON gc.category_name = 'behavior'
  WHERE sb.student_id = p_student_id
    AND sb.course_id = p_course_id

  ORDER BY scored_date DESC NULLS LAST;
END;
$$;


ALTER FUNCTION "public"."get_student_all_scores"("p_student_id" "text", "p_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_grade_breakdown"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("category_name" "text", "earned_points" numeric, "possible_points" numeric, "percentage" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'Hymns'::TEXT as category_name,
    g.hymns_earned_points,
    g.hymns_possible_points,
    CASE 
      WHEN g.hymns_possible_points > 0 THEN 
        ROUND((g.hymns_earned_points / g.hymns_possible_points * 100), 2)
      ELSE 0.00
    END as percentage
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
  
  UNION ALL
  
  SELECT 
    'Rituals'::TEXT,
    g.rituals_earned_points,
    g.rituals_possible_points,
    CASE 
      WHEN g.rituals_possible_points > 0 THEN 
        ROUND((g.rituals_earned_points / g.rituals_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Coptic'::TEXT,
    g.coptic_earned_points,
    g.coptic_possible_points,
    CASE 
      WHEN g.coptic_possible_points > 0 THEN 
        ROUND((g.coptic_earned_points / g.coptic_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Memorization'::TEXT,
    g.memorization_earned_points,
    g.memorization_possible_points,
    CASE 
      WHEN g.memorization_possible_points > 0 THEN 
        ROUND((g.memorization_earned_points / g.memorization_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Altar Responses'::TEXT,
    g.altar_responses_earned_points,
    g.altar_responses_possible_points,
    CASE 
      WHEN g.altar_responses_possible_points > 0 THEN 
        ROUND((g.altar_responses_earned_points / g.altar_responses_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Behavior'::TEXT,
    g.behavior_earned_points,
    g.behavior_possible_points,
    CASE 
      WHEN g.behavior_possible_points > 0 THEN 
        ROUND((g.behavior_earned_points / g.behavior_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Attendance'::TEXT,
    g.attendance_earned_points,
    g.attendance_possible_points,
    CASE 
      WHEN g.attendance_possible_points > 0 THEN 
        ROUND((g.attendance_earned_points / g.attendance_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id

  UNION ALL
  
  -- Extra Credit: Only adds to earned, NOT to possible (bonus points)
  SELECT 
    'Extra Credit'::TEXT,
    g.extra_credit_earned_points,
    0.00::DECIMAL(10,2) as possible_points,  -- No "possible" for extra credit
    0.00::DECIMAL(5,2) as percentage         -- N/A for extra credit
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id

  UNION ALL
  
  -- Total row showing overall grade
  SELECT 
    'TOTAL'::TEXT,
    g.total_earned_points,
    g.total_possible_points,
    g.weighted_percentage
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id;
END;
$$;


ALTER FUNCTION "public"."get_student_grade_breakdown"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_grade_summary"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("category_name" "text", "earned_points" numeric, "possible_points" numeric, "percentage" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'Hymns'::TEXT as category_name,
    g.hymns_earned_points,
    g.hymns_possible_points,
    CASE 
      WHEN g.hymns_possible_points > 0 THEN 
        ROUND((g.hymns_earned_points / g.hymns_possible_points * 100), 2)
      ELSE 0.00
    END as percentage
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
  
  UNION ALL
  
  SELECT 
    'Rituals'::TEXT,
    g.rituals_earned_points,
    g.rituals_possible_points,
    CASE 
      WHEN g.rituals_possible_points > 0 THEN 
        ROUND((g.rituals_earned_points / g.rituals_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Coptic'::TEXT,
    g.coptic_earned_points,
    g.coptic_possible_points,
    CASE 
      WHEN g.coptic_possible_points > 0 THEN 
        ROUND((g.coptic_earned_points / g.coptic_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Memorization'::TEXT,
    g.memorization_earned_points,
    g.memorization_possible_points,
    CASE 
      WHEN g.memorization_possible_points > 0 THEN 
        ROUND((g.memorization_earned_points / g.memorization_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Altar Responses'::TEXT,
    g.altar_responses_earned_points,
    g.altar_responses_possible_points,
    CASE 
      WHEN g.altar_responses_possible_points > 0 THEN 
        ROUND((g.altar_responses_earned_points / g.altar_responses_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Behavior'::TEXT,
    g.behavior_earned_points,
    g.behavior_possible_points,
    CASE 
      WHEN g.behavior_possible_points > 0 THEN 
        ROUND((g.behavior_earned_points / g.behavior_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id
    
  UNION ALL
  
  SELECT 
    'Attendance'::TEXT,
    g.attendance_earned_points,
    g.attendance_possible_points,
    CASE 
      WHEN g.attendance_possible_points > 0 THEN 
        ROUND((g.attendance_earned_points / g.attendance_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id

  UNION ALL
  
  -- Extra Credit: Only adds to earned, NOT to possible (bonus points)
  SELECT 
    'Extra Credit'::TEXT,
    g.extra_credit_earned_points,
    0.00::DECIMAL(10,2) as possible_points,  -- No "possible" for extra credit
    0.00::DECIMAL(5,2) as percentage         -- N/A for extra credit
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id

  UNION ALL
  
  -- Total row showing overall grade
  SELECT 
    'TOTAL'::TEXT,
    g.total_earned_points,
    g.total_possible_points,
    g.weighted_percentage
  FROM ds_student_final_grades g
  WHERE g.student_id = p_student_id 
    AND g.course_id = p_course_id;
END;
$$;


ALTER FUNCTION "public"."get_student_grade_summary"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_grade_summary"("p_student_id" character varying, "p_course_id" "uuid", "p_quarter_id" "uuid") RETURNS TABLE("category_name" "text", "earned_points" numeric, "possible_points" numeric, "percentage" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'Hymns'::TEXT as category_name,
    hymns_earned_points,
    hymns_possible_points,
    CASE 
      WHEN hymns_possible_points > 0 THEN 
        ROUND((hymns_earned_points / hymns_possible_points * 100), 2)
      ELSE 0.00
    END as percentage
  FROM ds_student_final_grades
  WHERE student_id = p_student_id 
    AND course_id = p_course_id 
    AND quarter_id = p_quarter_id
  
  UNION ALL
  
  SELECT 
    'Rituals'::TEXT,
    rituals_earned_points,
    rituals_possible_points,
    CASE 
      WHEN rituals_possible_points > 0 THEN 
        ROUND((rituals_earned_points / rituals_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades
  WHERE student_id = p_student_id 
    AND course_id = p_course_id 
    AND quarter_id = p_quarter_id
    
  UNION ALL
  
  SELECT 
    'Coptic'::TEXT,
    coptic_earned_points,
    coptic_possible_points,
    CASE 
      WHEN coptic_possible_points > 0 THEN 
        ROUND((coptic_earned_points / coptic_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades
  WHERE student_id = p_student_id 
    AND course_id = p_course_id 
    AND quarter_id = p_quarter_id
    
  UNION ALL
  
  SELECT 
    'Memorization'::TEXT,
    memorization_earned_points,
    memorization_possible_points,
    CASE 
      WHEN memorization_possible_points > 0 THEN 
        ROUND((memorization_earned_points / memorization_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades
  WHERE student_id = p_student_id 
    AND course_id = p_course_id 
    AND quarter_id = p_quarter_id
    
  UNION ALL
  
  SELECT 
    'Altar Responses'::TEXT,
    altar_responses_earned_points,
    altar_responses_possible_points,
    CASE 
      WHEN altar_responses_possible_points > 0 THEN 
        ROUND((altar_responses_earned_points / altar_responses_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades
  WHERE student_id = p_student_id 
    AND course_id = p_course_id 
    AND quarter_id = p_quarter_id
    
  UNION ALL
  
  SELECT 
    'Behavior'::TEXT,
    behavior_earned_points,
    behavior_possible_points,
    CASE 
      WHEN behavior_possible_points > 0 THEN 
        ROUND((behavior_earned_points / behavior_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades
  WHERE student_id = p_student_id 
    AND course_id = p_course_id 
    AND quarter_id = p_quarter_id
    
  UNION ALL
  
  SELECT 
    'Attendance'::TEXT,
    attendance_earned_points,
    attendance_possible_points,
    CASE 
      WHEN attendance_possible_points > 0 THEN 
        ROUND((attendance_earned_points / attendance_possible_points * 100), 2)
      ELSE 0.00
    END
  FROM ds_student_final_grades
  WHERE student_id = p_student_id 
    AND course_id = p_course_id 
    AND quarter_id = p_quarter_id;
END;
$$;


ALTER FUNCTION "public"."get_student_grade_summary"("p_student_id" character varying, "p_course_id" "uuid", "p_quarter_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_roles_and_services"("p_user_id" "text") RETURNS TABLE("portal_id" "text", "first_name" "text", "last_name" "text", "email" "text", "cellphone" "text", "dob" "date", "family_id" "text", "family_role" "text", "role_id" "text", "role_name" "text", "service_id" "text", "service_title" "text", "course_id" "uuid", "source_type" "text")
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN QUERY

    -- Service Roles
    SELECT 
        p.portal_id,
        p.first_name,
        p.last_name,
        p.email,
        p.cellphone,
        p.dob,
        p.family_id,
        p.family_role,
        r.role_id::text,
        r.role_name,
        v.service_id::text,
        v.service_title,
        NULL::uuid AS course_id,
        'service_role' AS source_type
    FROM profiles p
    JOIN user_service_roles s ON p.portal_id = s.portal_id
    JOIN roles_table r ON s.role_id = r.role_id
    JOIN services_table v ON s.service_id = v.service_id
    WHERE p.portal_id = p_user_id

    UNION ALL

    -- Course Teacher Roles
    SELECT 
        p.portal_id,
        p.first_name,
        p.last_name,
        p.email,
        p.cellphone,
        p.dob,
        p.family_id,
        p.family_role,
        r.role_id::text,
        r.role_name,
        NULL::text AS service_id,
        NULL::text AS service_title,
        d.course_id::uuid AS course_id,
        'course_teacher' AS source_type
    FROM profiles p
    JOIN ds_course_teachers d ON p.portal_id = d.teacher_id
    JOIN ds_courses dc ON dc.course_id = d.course_id
    JOIN roles_table r ON r.role_id = d.role
    WHERE p.portal_id = p_user_id

    UNION ALL

    -- Course Student Roles
    SELECT 
        p.portal_id,
        p.first_name,
        p.last_name,
        p.email,
        p.cellphone,
        p.dob,
        p.family_id,
        p.family_role,
        r.role_id::text,
        r.role_name,
        NULL::text AS service_id,
        NULL::text AS service_title,
        ds.course_id::uuid,
        'course_student' AS source_type
    FROM profiles p
    JOIN ds_student_enrollment ds ON p.portal_id = ds.student_id
    JOIN ds_courses dc ON dc.course_id = ds.course_id
    JOIN roles_table r ON r.role_id = ds.role
    WHERE p.portal_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."get_user_roles_and_services"("p_user_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  target_portal_id TEXT;
  existing_profile_count INTEGER;
  error_context TEXT;
BEGIN
  BEGIN
    -- Get the portal_id from metadata
    target_portal_id := NEW.raw_user_meta_data->>'portal_id';
    error_context := 'Getting portal_id from metadata';
    
    -- Log what we're working with
    RAISE NOTICE 'Processing user: %, portal_id: %, email: %', NEW.id, target_portal_id, NEW.email;
    
    -- Check if portal_id is null
    IF target_portal_id IS NULL THEN
      RAISE EXCEPTION 'portal_id is null in user metadata';
    END IF;
    
    error_context := 'Checking existing profile count';
    -- Check if profile with this portal_id already exists
    SELECT COUNT(*) INTO existing_profile_count 
    FROM public.profiles 
    WHERE portal_id = target_portal_id;
    
    RAISE NOTICE 'Found % existing profiles with portal_id: %', existing_profile_count, target_portal_id;
    
    IF existing_profile_count > 0 THEN
      error_context := 'Updating existing profile';
      -- Update existing profile with new auth user ID and email
      UPDATE public.profiles 
      SET 
        id = NEW.id,
        email = NEW.email,
        first_name = COALESCE(NEW.raw_user_meta_data->>'first_name', first_name),
        last_name = COALESCE(NEW.raw_user_meta_data->>'last_name', last_name),
        cellphone = COALESCE(NEW.raw_user_meta_data->>'cellphone', cellphone),
        dob = COALESCE(
          CASE 
            WHEN NEW.raw_user_meta_data->>'dob' IS NOT NULL AND NEW.raw_user_meta_data->>'dob' != '' 
            THEN (NEW.raw_user_meta_data->>'dob')::date 
            ELSE NULL 
          END, 
          dob
        ),
        family_id = COALESCE(NEW.raw_user_meta_data->>'family_id', family_id),
        family_role = COALESCE(NEW.raw_user_meta_data->>'family_role', family_role),
        updated_at = NOW()
      WHERE portal_id = target_portal_id;
      
      error_context := 'Upserting user_service_roles for existing profile';

      
    ELSE
      error_context := 'Creating new profile';
      -- Create new profile
      INSERT INTO public.profiles (
        id, first_name, last_name, cellphone, email, portal_id, dob, family_id, family_role
      )
      VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'first_name',
        NEW.raw_user_meta_data->>'last_name',
        NEW.raw_user_meta_data->>'cellphone',
        NEW.email,
        target_portal_id,
        CASE 
          WHEN NEW.raw_user_meta_data->>'dob' IS NOT NULL AND NEW.raw_user_meta_data->>'dob' != '' 
          THEN (NEW.raw_user_meta_data->>'dob')::date 
          ELSE NULL 
        END,
        NEW.raw_user_meta_data->>'family_id',
        NEW.raw_user_meta_data->>'family_role'
      );

      error_context := 'Inserting user_service_roles for new profile';
      -- Insert into user_service_roles table
      INSERT INTO public.user_service_roles (portal_id, role_id, service_id)
      VALUES (target_portal_id, 'member', 'congregation');
    END IF;

    RAISE NOTICE 'Successfully processed user with portal_id: %', target_portal_id;
    RETURN NEW;
    
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Error in handle_new_user at step "%": % (SQLSTATE: %)', 
        error_context, SQLERRM, SQLSTATE;
  END;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_into_userservice"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into public.user_service_roles (portal_id, role_id, service_id)
  values (new.portal_id, 'member', 'congregation');

  return new;
end;
$$;


ALTER FUNCTION "public"."insert_into_userservice"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_all_grades"("p_course_id" "uuid") RETURNS TABLE("student_id" character varying, "total_points" numeric, "success" boolean)
    LANGUAGE "plpgsql"
    AS $$DECLARE
  student_rec RECORD;
  calculated_points DECIMAL(10,2);
BEGIN
  FOR student_rec IN 
    SELECT DISTINCT s.student_id 
    FROM ds_student_scores s
    WHERE s.course_id = p_course_id 
      AND s.quarter_id = p_quarter_id
  LOOP
    BEGIN
      SELECT calculate_student_grade(student_rec.student_id, p_course_id, p_quarter_id)
      INTO calculated_points;
      
      RETURN QUERY SELECT student_rec.student_id, calculated_points, TRUE;
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT student_rec.student_id, 0.00::DECIMAL(10,2), FALSE;
    END;
  END LOOP;
END;$$;


ALTER FUNCTION "public"."recalculate_all_grades"("p_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_calculate_student_grade"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Call your parameterized function with values from NEW row
    PERFORM calculate_student_grade(NEW.student_id, NEW.course_id);
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_calculate_student_grade"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_student_attendance_scores"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    total_sessions INTEGER := 0;
    sessions_present INTEGER := 0;
    attendance_score INTEGER := 0;
BEGIN
    -- Calculate attendance statistics
    SELECT 
        COUNT(*)::INT,
        COALESCE(SUM(CASE WHEN present = true THEN 1 ELSE 0 END), 0)::INT
    INTO total_sessions, sessions_present
    FROM ds_attendance
    WHERE student_id = NEW.student_id 
      AND course_id = NEW.course_id;

    -- Avoid division by zero
    IF total_sessions > 0 THEN
        attendance_score := ROUND((sessions_present::NUMERIC / total_sessions::NUMERIC) * 100);
    ELSE
        attendance_score := 0;
    END IF;

    -- Insert or update the attendance score record
    INSERT INTO ds_student_attendance_scores (
        student_id,
        course_id,
        total_sessions,
        sessions_present,
        attendance_score,
        updated_at
    )
    VALUES (
        NEW.student_id,
        NEW.course_id,
        total_sessions,
        sessions_present,
        attendance_score,
        NOW()
    )
    ON CONFLICT (student_id, course_id)
    DO UPDATE SET
        total_sessions    = EXCLUDED.total_sessions,
        sessions_present  = EXCLUDED.sessions_present,
        attendance_score  = EXCLUDED.attendance_score,
        updated_at        = EXCLUDED.updated_at;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_student_attendance_scores"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_student_behavior_scores"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    total_sessions INTEGER := 0;
    sessions_good_behavior INTEGER := 0;
    behavior_score INTEGER := 0;
BEGIN
    -- Calculate behavior statistics
    SELECT 
        COUNT(*)::INT,
        COALESCE(SUM(CASE WHEN good_behavior = true THEN 1 ELSE 0 END), 0)::INT
    INTO total_sessions, sessions_good_behavior
    FROM ds_attendance
    WHERE student_id = NEW.student_id 
      AND course_id = NEW.course_id;

    -- Avoid division by zero
    IF total_sessions > 0 THEN
        behavior_score := ROUND((sessions_good_behavior::NUMERIC / total_sessions::NUMERIC) * 100);
    ELSE
        behavior_score := 0;
    END IF;

    -- Insert or update the attendance score record
    INSERT INTO ds_student_behavior_scores (
        student_id,
        course_id,
        total_sessions,
        sessions_good_behavior,
        behavior_score,
        updated_at
    )
    VALUES (
        NEW.student_id,
        NEW.course_id,
        total_sessions,
        sessions_good_behavior,
        behavior_score,
        NOW()
    )
    ON CONFLICT (student_id, course_id)
    DO UPDATE SET
        total_sessions    = EXCLUDED.total_sessions,
        sessions_good_behavior  = EXCLUDED.sessions_good_behavior,
        behavior_score  = EXCLUDED.behavior_score,
        updated_at        = EXCLUDED.updated_at;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_student_behavior_scores"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."announcments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone,
    "english_description" "text",
    "english_title" "text",
    "arabic_description" "text",
    "arabic_title" "text",
    "valid" boolean,
    "image_url" "text",
    "url" "text"
);


ALTER TABLE "public"."announcments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "portal_id" "text",
    "service_id" "text",
    "taken_by" "text",
    "date" "date",
    "timestamp" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."attendance" OWNER TO "postgres";


ALTER TABLE "public"."attendance" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."attendance_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."billing_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "plan_tier" "text" NOT NULL,
    "amount" integer NOT NULL,
    "status" "text" NOT NULL,
    "invoice_url" "text",
    "stripe_payment_intent_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "billing_history_status_check" CHECK (("status" = ANY (ARRAY['paid'::"text", 'pending'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."billing_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar" (
    "id" bigint NOT NULL,
    "eventDay" "public"."daysOfWeek",
    "eventTitle" "text",
    "location" "text",
    "repeated" "text",
    "starteventTime" time without time zone,
    "endeventTime" time without time zone,
    "one_timeEventDate" "date",
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."calendar" OWNER TO "postgres";


ALTER TABLE "public"."calendar" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."calendar_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."confession_availability_slots" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "slot_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "duration_minutes" integer DEFAULT 15,
    "status" character varying(20) DEFAULT 'available'::character varying,
    "max_capacity" integer DEFAULT 1,
    "current_bookings" integer DEFAULT 0,
    "priest_id" "uuid",
    "location" character varying(200) DEFAULT 'Office'::character varying,
    "special_instructions" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "confession_availability_slots_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['available'::character varying, 'booked'::character varying, 'blocked'::character varying, 'cancelled'::character varying])::"text"[]))),
    CONSTRAINT "valid_bookings" CHECK ((("current_bookings" >= 0) AND ("current_bookings" <= "max_capacity"))),
    CONSTRAINT "valid_capacity" CHECK (("max_capacity" > 0)),
    CONSTRAINT "valid_time_range" CHECK (("start_time" < "end_time"))
);


ALTER TABLE "public"."confession_availability_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."confessions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "text" NOT NULL,
    "availability_slot_id" "uuid" NOT NULL,
    "confession_date" "date" NOT NULL,
    "confession_time" time without time zone NOT NULL,
    "duration_minutes" integer DEFAULT 15,
    "confirmation_id" character varying(50) NOT NULL,
    "booking_reference" character varying(100),
    "status" character varying(20) DEFAULT 'scheduled'::character varying,
    "cancellation_reason" "text",
    "special_requests" "text",
    "notes" "text",
    "priest_id" "uuid",
    "reminder_sent" boolean DEFAULT false,
    "reminder_sent_at" timestamp with time zone,
    "confirmation_sent" boolean DEFAULT false,
    "confirmation_sent_at" timestamp with time zone,
    "scheduled_at" timestamp with time zone DEFAULT "now"(),
    "confirmed_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "confessions_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['scheduled'::character varying, 'confirmed'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'no_show'::character varying])::"text"[]))),
    CONSTRAINT "valid_confession_time" CHECK (("confession_time" IS NOT NULL)),
    CONSTRAINT "valid_duration" CHECK (("duration_minutes" > 0))
);


ALTER TABLE "public"."confessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deacons_school_altar_responses" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "response_name" "text",
    "level" "text",
    "recording" "text",
    "file_location" "text"
);


ALTER TABLE "public"."deacons_school_altar_responses" OWNER TO "postgres";


ALTER TABLE "public"."deacons_school_altar_responses" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."deacons_school_altar_responses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."deacons_school_calendar" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "item_key" "text",
    "item_id" bigint,
    "week_num_id" bigint,
    "ds_teacher_id" bigint
);


ALTER TABLE "public"."deacons_school_calendar" OWNER TO "postgres";


ALTER TABLE "public"."deacons_school_calendar" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."deacons_school_calendar_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."deacons_school_coptic" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text",
    "url" "text",
    "level" "text"
);


ALTER TABLE "public"."deacons_school_coptic" OWNER TO "postgres";


COMMENT ON TABLE "public"."deacons_school_coptic" IS 'This is a duplicate of deacons_school_rituals';



ALTER TABLE "public"."deacons_school_coptic" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."deacons_school_coptic_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."deacons_school_hymn_hazzat" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hymn_id" integer NOT NULL,
    "title" "text" NOT NULL,
    "url" "text" NOT NULL,
    "type" "text" DEFAULT 'pdf'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."deacons_school_hymn_hazzat" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deacons_school_hymn_recordings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hymn_id" integer NOT NULL,
    "title" "text" NOT NULL,
    "url" "text" NOT NULL,
    "type" "text" DEFAULT 'youtube'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."deacons_school_hymn_recordings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deacons_school_hymns" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hymn_name" "text",
    "hymn_recording" "text",
    "level_hymn_in" "text",
    "hymn_file_location" "text" DEFAULT ''::"text",
    "hymn_ritual" "text",
    "points" bigint,
    "hazzat" "text",
    "order_taught" bigint,
    "tune_file_path" "text"[],
    "folder_id" integer
);


ALTER TABLE "public"."deacons_school_hymns" OWNER TO "postgres";


ALTER TABLE "public"."deacons_school_hymns" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."deacons_school_hymns_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."deacons_school_memorization" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text",
    "file_location" "text",
    "level" "text"
);


ALTER TABLE "public"."deacons_school_memorization" OWNER TO "postgres";


COMMENT ON TABLE "public"."deacons_school_memorization" IS 'Deacons School Memorization';



ALTER TABLE "public"."deacons_school_memorization" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."deacons_school_memorization_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."deacons_school_rituals" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text",
    "url" "text",
    "level" "text"
);


ALTER TABLE "public"."deacons_school_rituals" OWNER TO "postgres";


ALTER TABLE "public"."deacons_school_rituals" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."deacons_school_rituals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."diptych" (
    "id" bigint NOT NULL,
    "departed_name" "text" NOT NULL,
    "departed_relatives" "text",
    "memorial_type" "text",
    "liturgy_date" "date"
);


ALTER TABLE "public"."diptych" OWNER TO "postgres";


ALTER TABLE "public"."diptych" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."diptych_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ds_assessment_items" (
    "item_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_id" "uuid",
    "item_reference" "text",
    "reference_id" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "item_name" "text",
    "course_id" "uuid",
    "max_points" numeric,
    "is_extra_credit" boolean
);


ALTER TABLE "public"."ds_assessment_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_attendance" (
    "attendance_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "text" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "notes" "text",
    "recorded_at" timestamp with time zone DEFAULT "now"(),
    "recorded_by" "text",
    "present" boolean,
    "course_id" "uuid",
    "good_behavior" boolean
);


ALTER TABLE "public"."ds_attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_calendar_teacher_assignments" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "calendar_id" bigint,
    "course_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hymn_teacher_id" "text",
    "other_teacher_id" "text",
    "assigned_by" "text"
);


ALTER TABLE "public"."ds_calendar_teacher_assignments" OWNER TO "postgres";


ALTER TABLE "public"."ds_calendar_teacher_assignments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ds_calendar_teacher_assignments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ds_calendar_week" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "week_num" bigint,
    "calendar_day" "date",
    "level" "text",
    "hymn_id" bigint,
    "others_id" bigint,
    "others_tablename" "text",
    "courses_id" "uuid"[]
);


ALTER TABLE "public"."ds_calendar_week" OWNER TO "postgres";


ALTER TABLE "public"."ds_calendar_week" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ds_calendar_week_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ds_class_sessions" (
    "session_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid",
    "session_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "topic" "text",
    "updated_at" timestamp with time zone,
    "recorded_by" "text"
);


ALTER TABLE "public"."ds_class_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_coptic_lesson_by_level" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text",
    "material" "text",
    "quiz" "text",
    "level" "text"
);


ALTER TABLE "public"."ds_coptic_lesson_by_level" OWNER TO "postgres";


COMMENT ON TABLE "public"."ds_coptic_lesson_by_level" IS 'This is a duplicate of ds_coptic_rituals_lesson_by_lesson';



ALTER TABLE "public"."ds_coptic_lesson_by_level" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ds_coptic_lesson_by_lesson_duplicate_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ds_rituals_lesson_by_level" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text",
    "material" "text",
    "quiz" "text",
    "level" "text",
    "table_name" "text" DEFAULT 'ds_rituals_lesson_by_level'::"text"
);


ALTER TABLE "public"."ds_rituals_lesson_by_level" OWNER TO "postgres";


ALTER TABLE "public"."ds_rituals_lesson_by_level" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ds_coptic_rituals_lesson_by_lesson_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ds_course_teachers" (
    "course_teacher_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid",
    "teacher_id" "text",
    "role" "public"."roles",
    "assigned_date" "date" DEFAULT CURRENT_DATE,
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."ds_course_teachers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_courses" (
    "course_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_name" "text" NOT NULL,
    "level" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "academic_year" "text" DEFAULT '2025-2026'::"text"
);


ALTER TABLE "public"."ds_courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_grading_categories" (
    "category_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_name" "text" NOT NULL,
    "weight_percentage" numeric(5,2) NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."ds_grading_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_quarters" (
    "quarter_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quarter_name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."ds_quarters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_student_attendance_scores" (
    "attendance_score_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "text" NOT NULL,
    "course_id" "uuid",
    "quarter_id" "uuid",
    "total_sessions" integer DEFAULT 0 NOT NULL,
    "sessions_present" integer DEFAULT 0 NOT NULL,
    "attendance_score" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."ds_student_attendance_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_student_behavior_scores" (
    "behavior_score_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "text" NOT NULL,
    "course_id" "uuid",
    "quarter_id" "uuid",
    "total_sessions" numeric(6,2) DEFAULT 0,
    "sessions_good_behavior" numeric(6,2) DEFAULT 0,
    "behavior_score" numeric(6,2) DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."ds_student_behavior_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_student_enrollment" (
    "enrollment_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "text",
    "course_id" "uuid",
    "enrolled_date" "date" DEFAULT CURRENT_DATE,
    "is_active" boolean DEFAULT true,
    "role" "public"."roles" DEFAULT 'deacon_school_student'::"public"."roles"
);


ALTER TABLE "public"."ds_student_enrollment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_student_final_grades" (
    "grade_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "text" NOT NULL,
    "course_id" "uuid",
    "hymns_earned_points" numeric(10,2) DEFAULT 0,
    "hymns_possible_points" numeric(10,2) DEFAULT 0,
    "coptic_earned_points" numeric(10,2) DEFAULT 0,
    "coptic_possible_points" numeric(10,2) DEFAULT 0,
    "rituals_earned_points" numeric(10,2) DEFAULT 0,
    "total_earned_points" numeric(5,2) DEFAULT 0,
    "rituals_possible_points" numeric(5,2) DEFAULT 0,
    "memorization_earned_points" numeric(10,2) DEFAULT 0,
    "memorization_possible_points" numeric(5,2) DEFAULT 0,
    "altar_responses_earned_points" numeric(10,2) DEFAULT 0,
    "is_passing_year" boolean DEFAULT false,
    "calculated_at" timestamp without time zone DEFAULT "now"(),
    "altar_responses_possible_points" numeric,
    "behavior_earned_points" numeric,
    "behavior_possible_points" numeric,
    "attendance_earned_points" numeric,
    "attendance_possible_points" numeric,
    "total_possible_points" numeric,
    "weighted_percentage" numeric,
    "extra_credit_earned_points" numeric
);


ALTER TABLE "public"."ds_student_final_grades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_student_scores" (
    "score_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "text" NOT NULL,
    "course_id" "uuid",
    "quarter_id" "uuid",
    "item_id" "uuid",
    "points_earned" numeric(8,2) DEFAULT 0 NOT NULL,
    "points_possible" numeric(8,2) NOT NULL,
    "scored_date" timestamp with time zone,
    "scored_by" "text" NOT NULL,
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "academic_year" "text"
);


ALTER TABLE "public"."ds_student_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ds_teacher_attendance" (
    "attendance_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "text" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "notes" "text",
    "recorded_at" timestamp with time zone DEFAULT "now"(),
    "recorded_by" "text",
    "present" boolean,
    "course_id" "uuid",
    "good_behavior" boolean
);


ALTER TABLE "public"."ds_teacher_attendance" OWNER TO "postgres";


COMMENT ON TABLE "public"."ds_teacher_attendance" IS 'This is a ds_teacher_attendance';



CREATE TABLE IF NOT EXISTS "public"."ds_yearly_requirements" (
    "requirement_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid",
    "academic_year" character varying(9) NOT NULL,
    "total_points_to_pass" numeric(10,2) NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."ds_yearly_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hymn_folder_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "folder_id" "uuid" NOT NULL,
    "hymn_id" integer NOT NULL,
    "sort_order" integer DEFAULT 0,
    "notes" "text",
    "added_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."hymn_folder_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hymns_folders" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text",
    "url" "text",
    "parent_id" integer
);


ALTER TABLE "public"."hymns_folders" OWNER TO "postgres";


ALTER TABLE "public"."hymns_folders" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."hymns_folders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."join_service_request" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text",
    "cellphone" "text",
    "church_service" "text"
);


ALTER TABLE "public"."join_service_request" OWNER TO "postgres";


ALTER TABLE "public"."join_service_request" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."join_service_request_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."monthly_blog_article" (
    "id" bigint NOT NULL,
    "english_title" "text" NOT NULL,
    "english_author" "text",
    "english_article" "text",
    "arabic_title" "text",
    "arabic_author" "text",
    "arabic_article" "text",
    "image_url" "text",
    "view_month" "text"
);


ALTER TABLE "public"."monthly_blog_article" OWNER TO "postgres";


ALTER TABLE "public"."monthly_blog_article" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."monthly_blog_article_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."prayerRequests" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "message" "text",
    "full_name" "text",
    "cellphone" "text",
    "email" "text"
);


ALTER TABLE "public"."prayerRequests" OWNER TO "postgres";


ALTER TABLE "public"."prayerRequests" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."prayerRequests_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "updated_at" timestamp with time zone,
    "email" "text",
    "first_name" "text",
    "last_name" "text",
    "portal_id" "text" DEFAULT ''::"text" NOT NULL,
    "cellphone" "text",
    "dob" "date",
    "family_id" "text",
    "family_role" "text",
    CONSTRAINT "username_length" CHECK (("char_length"("email") >= 3))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles_table" (
    "role_id" "public"."roles" NOT NULL,
    "role_name" "text" NOT NULL,
    "priority" smallint
);


ALTER TABLE "public"."roles_table" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_id" "text" NOT NULL,
    "message" "text",
    "url" "text",
    "image_url" "text",
    "valid" boolean DEFAULT true
);


ALTER TABLE "public"."service_announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_lesson" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service" "text" NOT NULL,
    "title" "text",
    "description" "text",
    "verse" "text",
    "date_of_lesson" "date",
    "assignee" "uuid"
);


ALTER TABLE "public"."service_lesson" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services_table" (
    "service_id" "text" NOT NULL,
    "service_title" "text" NOT NULL,
    "description" "text",
    "time_held" time without time zone,
    "day_of_week" "public"."daysOfWeek",
    "group_link" "text",
    "request_to_join" boolean DEFAULT true,
    "announcement_panel" boolean DEFAULT true,
    "week_lesson" boolean DEFAULT false,
    "mother_service" "text"
);


ALTER TABLE "public"."services_table" OWNER TO "postgres";


COMMENT ON COLUMN "public"."services_table"."description" IS 'This meeting is held by Fr.Serapion every week on Mondays at 7:00 PM. It is held in the main church and it is also livestreamed on our Facebook and Youtube Pages';



CREATE TABLE IF NOT EXISTS "public"."user_service_roles" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "portal_id" "text",
    "role_id" "public"."roles",
    "service_id" "text"
);


ALTER TABLE "public"."user_service_roles" OWNER TO "postgres";


ALTER TABLE "public"."user_service_roles" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_service_roles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_tokens" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "token" "text" NOT NULL,
    "generalNotificationsAllowed" boolean,
    "userId" "uuid" DEFAULT "auth"."uid"(),
    "service_subscribed" "text"[]
);


ALTER TABLE "public"."user_tokens" OWNER TO "postgres";


ALTER TABLE "public"."user_tokens" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."v_attendance_pct" (
    "coalesce" numeric
);


ALTER TABLE "public"."v_attendance_pct" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visitation_reservation" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slot_id" bigint,
    "reason" "text",
    "address" "text",
    "confirmed" boolean DEFAULT false
);


ALTER TABLE "public"."visitation_reservation" OWNER TO "postgres";


ALTER TABLE "public"."visitation_reservation" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."visitation_reservation_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."visitation_slots" (
    "id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "day_of_week" "public"."daysOfWeek",
    "start_time" time without time zone,
    "available" boolean DEFAULT true,
    "end_time" time without time zone
);


ALTER TABLE "public"."visitation_slots" OWNER TO "postgres";


ALTER TABLE "public"."visitation_slots" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."visitation_slots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "sundaySchool"."classesInformation" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "classKey" "public"."ServicesAvailable" NOT NULL,
    "meetingTime" time without time zone,
    "dayOfWeek" "text",
    "servants" "text",
    "className" "text",
    "serviceIn" "text"
);


ALTER TABLE "sundaySchool"."classesInformation" OWNER TO "postgres";


ALTER TABLE "sundaySchool"."classesInformation" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "sundaySchool"."classesInformation_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."announcments"
    ADD CONSTRAINT "announcments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_history"
    ADD CONSTRAINT "billing_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar"
    ADD CONSTRAINT "calendar_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."confession_availability_slots"
    ADD CONSTRAINT "confession_availability_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."confessions"
    ADD CONSTRAINT "confessions_confirmation_id_key" UNIQUE ("confirmation_id");



ALTER TABLE ONLY "public"."confessions"
    ADD CONSTRAINT "confessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deacons_school_altar_responses"
    ADD CONSTRAINT "deacons_school_altar_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deacons_school_calendar"
    ADD CONSTRAINT "deacons_school_calendar_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deacons_school_coptic"
    ADD CONSTRAINT "deacons_school_coptic_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deacons_school_hymn_hazzat"
    ADD CONSTRAINT "deacons_school_hymn_hazzat_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deacons_school_hymn_recordings"
    ADD CONSTRAINT "deacons_school_hymn_recordings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deacons_school_hymns"
    ADD CONSTRAINT "deacons_school_hymns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deacons_school_memorization"
    ADD CONSTRAINT "deacons_school_memorization_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deacons_school_rituals"
    ADD CONSTRAINT "deacons_school_rituals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."diptych"
    ADD CONSTRAINT "diptych_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ds_assessment_items"
    ADD CONSTRAINT "ds_assessment_items_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."ds_attendance"
    ADD CONSTRAINT "ds_attendance_pkey" PRIMARY KEY ("attendance_id");



ALTER TABLE ONLY "public"."ds_calendar_teacher_assignments"
    ADD CONSTRAINT "ds_calendar_teacher_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ds_calendar_week"
    ADD CONSTRAINT "ds_calendar_week_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ds_attendance"
    ADD CONSTRAINT "ds_class_attendance_unique" UNIQUE ("student_id", "session_id");



ALTER TABLE ONLY "public"."ds_student_attendance_scores"
    ADD CONSTRAINT "ds_class_attendance_unique_score" UNIQUE ("student_id", "course_id");



ALTER TABLE ONLY "public"."ds_class_sessions"
    ADD CONSTRAINT "ds_class_sessions_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "public"."ds_class_sessions"
    ADD CONSTRAINT "ds_class_sessions_unique" UNIQUE ("course_id", "session_date");



ALTER TABLE ONLY "public"."ds_coptic_lesson_by_level"
    ADD CONSTRAINT "ds_coptic_lesson_by_lesson_duplicate_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ds_rituals_lesson_by_level"
    ADD CONSTRAINT "ds_coptic_rituals_lesson_by_lesson_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ds_course_teachers"
    ADD CONSTRAINT "ds_course_teachers_course_id_teacher_id_key" UNIQUE ("course_id", "teacher_id");



ALTER TABLE ONLY "public"."ds_course_teachers"
    ADD CONSTRAINT "ds_course_teachers_pkey" PRIMARY KEY ("course_teacher_id");



ALTER TABLE ONLY "public"."ds_courses"
    ADD CONSTRAINT "ds_courses_pkey" PRIMARY KEY ("course_id");



ALTER TABLE ONLY "public"."ds_student_enrollment"
    ADD CONSTRAINT "ds_enrollments_pkey" PRIMARY KEY ("enrollment_id");



ALTER TABLE ONLY "public"."ds_student_enrollment"
    ADD CONSTRAINT "ds_enrollments_student_id_course_id_key" UNIQUE ("student_id", "course_id");



ALTER TABLE ONLY "public"."ds_grading_categories"
    ADD CONSTRAINT "ds_grading_categories_category_name_key" UNIQUE ("category_name");



ALTER TABLE ONLY "public"."ds_grading_categories"
    ADD CONSTRAINT "ds_grading_categories_pkey" PRIMARY KEY ("category_id");



ALTER TABLE ONLY "public"."ds_quarters"
    ADD CONSTRAINT "ds_quarters_pkey" PRIMARY KEY ("quarter_id");



ALTER TABLE ONLY "public"."ds_student_scores"
    ADD CONSTRAINT "ds_scores_unique" UNIQUE ("student_id", "course_id", "item_id");



ALTER TABLE ONLY "public"."ds_student_attendance_scores"
    ADD CONSTRAINT "ds_student_attendance_scores_pkey" PRIMARY KEY ("attendance_score_id");



ALTER TABLE ONLY "public"."ds_student_attendance_scores"
    ADD CONSTRAINT "ds_student_attendance_scores_student_id_course_id_quarter_i_key" UNIQUE ("student_id", "course_id", "quarter_id");



ALTER TABLE ONLY "public"."ds_student_behavior_scores"
    ADD CONSTRAINT "ds_student_behavior_scores_pkey" PRIMARY KEY ("behavior_score_id");



ALTER TABLE ONLY "public"."ds_student_behavior_scores"
    ADD CONSTRAINT "ds_student_behavior_scores_student_id_course_id_quarter_id_key" UNIQUE ("student_id", "course_id", "quarter_id");



ALTER TABLE ONLY "public"."ds_student_final_grades"
    ADD CONSTRAINT "ds_student_final_grades_pkey" PRIMARY KEY ("grade_id");



ALTER TABLE ONLY "public"."ds_student_scores"
    ADD CONSTRAINT "ds_student_scores_pkey" PRIMARY KEY ("score_id");



ALTER TABLE ONLY "public"."ds_student_scores"
    ADD CONSTRAINT "ds_student_scores_student_id_course_id_quarter_id_item_id_key" UNIQUE ("student_id", "course_id", "quarter_id", "item_id");



ALTER TABLE ONLY "public"."ds_teacher_attendance"
    ADD CONSTRAINT "ds_teacher_attendance_pkey" PRIMARY KEY ("attendance_id");



ALTER TABLE ONLY "public"."ds_teacher_attendance"
    ADD CONSTRAINT "ds_teacher_attendance_student_id_session_id_key" UNIQUE ("teacher_id", "session_id");



ALTER TABLE ONLY "public"."ds_yearly_requirements"
    ADD CONSTRAINT "ds_yearly_requirements_course_id_academic_year_key" UNIQUE ("course_id", "academic_year");



ALTER TABLE ONLY "public"."ds_yearly_requirements"
    ADD CONSTRAINT "ds_yearly_requirements_pkey" PRIMARY KEY ("requirement_id");



ALTER TABLE ONLY "public"."hymn_folder_items"
    ADD CONSTRAINT "hymn_folder_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hymns_folders"
    ADD CONSTRAINT "hymns_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."join_service_request"
    ADD CONSTRAINT "join_service_request_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_blog_article"
    ADD CONSTRAINT "monthly_blog_article_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prayerRequests"
    ADD CONSTRAINT "prayerRequests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("portal_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_portal_id_key" UNIQUE ("portal_id");



ALTER TABLE ONLY "public"."roles_table"
    ADD CONSTRAINT "roles_table_pkey" PRIMARY KEY ("role_id");



ALTER TABLE ONLY "public"."service_announcements"
    ADD CONSTRAINT "service_announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_lesson"
    ADD CONSTRAINT "service_lesson_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services_table"
    ADD CONSTRAINT "services_table_pkey" PRIMARY KEY ("service_id");



ALTER TABLE ONLY "public"."ds_assessment_items"
    ADD CONSTRAINT "unique_assesment" UNIQUE ("item_reference", "reference_id", "course_id");



ALTER TABLE ONLY "public"."ds_calendar_teacher_assignments"
    ADD CONSTRAINT "unique_calendar_course" UNIQUE ("calendar_id", "course_id");



ALTER TABLE ONLY "public"."hymn_folder_items"
    ADD CONSTRAINT "unique_hymn_in_folder" UNIQUE ("folder_id", "hymn_id");



ALTER TABLE ONLY "public"."ds_calendar_week"
    ADD CONSTRAINT "unique_hymn_level" UNIQUE ("calendar_day", "level");



ALTER TABLE ONLY "public"."ds_student_final_grades"
    ADD CONSTRAINT "uq_student_course" UNIQUE ("student_id", "course_id");



ALTER TABLE ONLY "public"."ds_student_behavior_scores"
    ADD CONSTRAINT "uq_student_course_behavior" UNIQUE ("student_id", "course_id");



ALTER TABLE ONLY "public"."user_service_roles"
    ADD CONSTRAINT "user_service_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_tokens"
    ADD CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id", "token");



ALTER TABLE ONLY "public"."user_tokens"
    ADD CONSTRAINT "user_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."visitation_reservation"
    ADD CONSTRAINT "visitation_reservation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visitation_slots"
    ADD CONSTRAINT "visitation_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sundaySchool"."classesInformation"
    ADD CONSTRAINT "classesInformation_pkey" PRIMARY KEY ("id", "classKey");



CREATE INDEX "ds_teacher_attendance_student_id_session_id_idx" ON "public"."ds_teacher_attendance" USING "btree" ("teacher_id", "session_id");



CREATE UNIQUE INDEX "ds_teacher_attendance_student_id_session_id_idx1" ON "public"."ds_teacher_attendance" USING "btree" ("teacher_id", "session_id");



CREATE INDEX "idx_attendance_date" ON "public"."attendance" USING "btree" ("date");



CREATE INDEX "idx_attendance_portal_date" ON "public"."attendance" USING "btree" ("portal_id", "date");



CREATE INDEX "idx_attendance_portal_id" ON "public"."attendance" USING "btree" ("portal_id");



CREATE INDEX "idx_attendance_service_type" ON "public"."attendance" USING "btree" ("service_id");



CREATE UNIQUE INDEX "idx_attendance_unique_daily" ON "public"."attendance" USING "btree" ("portal_id", "date", "service_id");



CREATE INDEX "idx_billing_history_created_at" ON "public"."billing_history" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_billing_history_user_id" ON "public"."billing_history" USING "btree" ("user_id");



CREATE INDEX "idx_confessions_confirmation" ON "public"."confessions" USING "btree" ("confirmation_id");



CREATE INDEX "idx_confessions_date" ON "public"."confessions" USING "btree" ("confession_date");



CREATE INDEX "idx_confessions_priest" ON "public"."confessions" USING "btree" ("priest_id");



CREATE INDEX "idx_confessions_slot" ON "public"."confessions" USING "btree" ("availability_slot_id");



CREATE INDEX "idx_confessions_status" ON "public"."confessions" USING "btree" ("status");



CREATE INDEX "idx_confessions_user" ON "public"."confessions" USING "btree" ("user_id");



CREATE INDEX "idx_ds_attendance_student_session" ON "public"."ds_attendance" USING "btree" ("student_id", "session_id");



CREATE INDEX "idx_ds_sessions_course_date" ON "public"."ds_class_sessions" USING "btree" ("course_id", "session_date");



CREATE INDEX "idx_dsh_folder" ON "public"."deacons_school_hymns" USING "btree" ("folder_id");



CREATE INDEX "idx_dsh_hazzat_hymn" ON "public"."deacons_school_hymn_hazzat" USING "btree" ("hymn_id");



CREATE INDEX "idx_dsh_recordings_hymn" ON "public"."deacons_school_hymn_recordings" USING "btree" ("hymn_id");



CREATE INDEX "idx_hymn_folder_items_folder" ON "public"."hymn_folder_items" USING "btree" ("folder_id");



CREATE INDEX "idx_hymn_folder_items_hymn" ON "public"."hymn_folder_items" USING "btree" ("hymn_id");



CREATE INDEX "idx_hymn_folder_items_sort" ON "public"."hymn_folder_items" USING "btree" ("folder_id", "sort_order");



CREATE UNIQUE INDEX "unique_sessionid_studentid" ON "public"."ds_attendance" USING "btree" ("student_id", "session_id");



CREATE OR REPLACE TRIGGER "post_profile_insert" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."insert_into_userservice"();



CREATE OR REPLACE TRIGGER "trg_update_attendance_scores" AFTER INSERT OR UPDATE ON "public"."ds_attendance" FOR EACH ROW EXECUTE FUNCTION "public"."update_student_attendance_scores"();



CREATE OR REPLACE TRIGGER "trg_update_behavior_scores" AFTER INSERT OR UPDATE ON "public"."ds_attendance" FOR EACH ROW EXECUTE FUNCTION "public"."update_student_behavior_scores"();



CREATE OR REPLACE TRIGGER "trg_update_final_scores_attendance" AFTER INSERT OR UPDATE ON "public"."ds_student_attendance_scores" FOR EACH ROW EXECUTE FUNCTION "public"."trg_calculate_student_grade"();



CREATE OR REPLACE TRIGGER "trg_update_final_scores_behavior" AFTER INSERT OR UPDATE ON "public"."ds_student_behavior_scores" FOR EACH ROW EXECUTE FUNCTION "public"."trg_calculate_student_grade"();



CREATE OR REPLACE TRIGGER "trg_update_final_scores_scores" AFTER INSERT OR UPDATE ON "public"."ds_student_scores" FOR EACH ROW EXECUTE FUNCTION "public"."trg_calculate_student_grade"();



CREATE OR REPLACE TRIGGER "update_attendance_updated_at" BEFORE UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."billing_history"
    ADD CONSTRAINT "billing_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."confessions"
    ADD CONSTRAINT "confessions_availability_slot_id_fkey" FOREIGN KEY ("availability_slot_id") REFERENCES "public"."confession_availability_slots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."confessions"
    ADD CONSTRAINT "confessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("portal_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deacons_school_hymn_hazzat"
    ADD CONSTRAINT "deacons_school_hymn_hazzat_hymn_id_fkey" FOREIGN KEY ("hymn_id") REFERENCES "public"."deacons_school_hymns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deacons_school_hymn_recordings"
    ADD CONSTRAINT "deacons_school_hymn_recordings_hymn_id_fkey" FOREIGN KEY ("hymn_id") REFERENCES "public"."deacons_school_hymns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deacons_school_hymns"
    ADD CONSTRAINT "deacons_school_hymns_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."hymns_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ds_assessment_items"
    ADD CONSTRAINT "ds_assessment_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."ds_grading_categories"("category_id");



ALTER TABLE ONLY "public"."ds_assessment_items"
    ADD CONSTRAINT "ds_assessment_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id");



ALTER TABLE ONLY "public"."ds_attendance"
    ADD CONSTRAINT "ds_attendance_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id");



ALTER TABLE ONLY "public"."ds_attendance"
    ADD CONSTRAINT "ds_attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."ds_class_sessions"("session_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ds_attendance"
    ADD CONSTRAINT "ds_attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("portal_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ds_calendar_teacher_assignments"
    ADD CONSTRAINT "ds_calendar_teacher_assignments_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "public"."ds_calendar_week"("id");



ALTER TABLE ONLY "public"."ds_calendar_teacher_assignments"
    ADD CONSTRAINT "ds_calendar_teacher_assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id");



ALTER TABLE ONLY "public"."ds_class_sessions"
    ADD CONSTRAINT "ds_class_sessions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ds_course_teachers"
    ADD CONSTRAINT "ds_course_teachers_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ds_student_enrollment"
    ADD CONSTRAINT "ds_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ds_student_enrollment"
    ADD CONSTRAINT "ds_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("portal_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ds_student_attendance_scores"
    ADD CONSTRAINT "ds_student_attendance_scores_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id");



ALTER TABLE ONLY "public"."ds_student_attendance_scores"
    ADD CONSTRAINT "ds_student_attendance_scores_quarter_id_fkey" FOREIGN KEY ("quarter_id") REFERENCES "public"."ds_quarters"("quarter_id");



ALTER TABLE ONLY "public"."ds_student_behavior_scores"
    ADD CONSTRAINT "ds_student_behavior_scores_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id");



ALTER TABLE ONLY "public"."ds_student_behavior_scores"
    ADD CONSTRAINT "ds_student_behavior_scores_quarter_id_fkey" FOREIGN KEY ("quarter_id") REFERENCES "public"."ds_quarters"("quarter_id");



ALTER TABLE ONLY "public"."ds_student_final_grades"
    ADD CONSTRAINT "ds_student_final_grades_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id");



ALTER TABLE ONLY "public"."ds_student_scores"
    ADD CONSTRAINT "ds_student_scores_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id");



ALTER TABLE ONLY "public"."ds_student_scores"
    ADD CONSTRAINT "ds_student_scores_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."ds_assessment_items"("item_id");



ALTER TABLE ONLY "public"."ds_student_scores"
    ADD CONSTRAINT "ds_student_scores_quarter_id_fkey" FOREIGN KEY ("quarter_id") REFERENCES "public"."ds_quarters"("quarter_id");



ALTER TABLE ONLY "public"."ds_teacher_attendance"
    ADD CONSTRAINT "ds_teacher_attendance_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id");



ALTER TABLE ONLY "public"."ds_teacher_attendance"
    ADD CONSTRAINT "ds_teacher_attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."ds_class_sessions"("session_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ds_teacher_attendance"
    ADD CONSTRAINT "ds_teacher_attendance_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("portal_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ds_yearly_requirements"
    ADD CONSTRAINT "ds_yearly_requirements_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."ds_courses"("course_id");



ALTER TABLE ONLY "public"."hymns_folders"
    ADD CONSTRAINT "hymns_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."hymns_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_service_roles"
    ADD CONSTRAINT "public_user_service_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles_table"("role_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."visitation_reservation"
    ADD CONSTRAINT "public_visitation_reservation_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."visitation_slots"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_service_roles"
    ADD CONSTRAINT "user_service_roles_portal_id_fkey" FOREIGN KEY ("portal_id") REFERENCES "public"."profiles"("portal_id");



CREATE POLICY "Delete service_role" ON "public"."user_service_roles" FOR DELETE USING (true);



CREATE POLICY "Enable Edit access for all users" ON "public"."deacons_school_hymns" FOR UPDATE USING (true);



CREATE POLICY "Enable d eletefor authenticated users only" ON "public"."announcments" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "Enable delete access for all users" ON "public"."diptych" FOR DELETE USING (true);



CREATE POLICY "Enable delete access for all users" ON "public"."ds_assessment_items" FOR DELETE USING (true);



CREATE POLICY "Enable delete access for all users" ON "public"."ds_attendance" FOR DELETE USING (true);



CREATE POLICY "Enable delete access for all users" ON "public"."ds_course_teachers" FOR DELETE USING (true);



CREATE POLICY "Enable delete for authenticated users only" ON "public"."calendar" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "Enable delete for users based on user_id" ON "public"."prayerRequests" FOR DELETE USING (true);



CREATE POLICY "Enable edit access for all users" ON "public"."deacons_school_memorization" FOR UPDATE USING (true);



CREATE POLICY "Enable insert access for all users" ON "public"."ds_calendar_teacher_assignments" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert access for all users" ON "public"."ds_class_sessions" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert access for all users" ON "public"."ds_student_behavior_scores" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert access for all users" ON "public"."ds_student_final_grades" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert access for all users" ON "public"."ds_student_scores" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert access for all users" ON "public"."ds_teacher_attendance" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert access for all users" ON "public"."profiles" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."announcments" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."attendance" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."calendar" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."confession_availability_slots" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."confessions" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."deacons_school_hymn_hazzat" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."deacons_school_hymns" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."ds_assessment_items" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."ds_calendar_week" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."ds_student_attendance_scores" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."join_service_request" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."service_announcements" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."service_lesson" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."user_service_roles" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."user_tokens" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for everyone" ON "public"."prayerRequests" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable insert for everyone " ON "public"."visitation_reservation" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable read  read access for all users" ON "public"."diptych" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."announcments" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."attendance" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."calendar" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."confession_availability_slots" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."confessions" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."deacons_school_altar_responses" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."deacons_school_coptic" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."deacons_school_hymn_hazzat" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."deacons_school_hymns" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."deacons_school_memorization" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."deacons_school_rituals" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."diptych" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_assessment_items" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_attendance" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_calendar_teacher_assignments" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_class_sessions" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_coptic_lesson_by_level" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_course_teachers" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_courses" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_grading_categories" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_quarters" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_rituals_lesson_by_level" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_student_attendance_scores" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_student_behavior_scores" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_student_enrollment" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_student_final_grades" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_student_scores" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ds_teacher_attendance" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."hymns_folders" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."join_service_request" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."monthly_blog_article" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."profiles" FOR UPDATE USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."roles_table" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."service_announcements" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."service_lesson" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."services_table" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."user_service_roles" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."user_tokens" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."visitation_reservation" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."visitation_slots" FOR SELECT USING (true);



CREATE POLICY "Enable read access for auth" ON "public"."prayerRequests" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."deacons_school_altar_responses" FOR UPDATE USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."deacons_school_rituals" FOR UPDATE USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_attendance" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_calendar_teacher_assignments" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_class_sessions" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_coptic_lesson_by_level" FOR UPDATE USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_rituals_lesson_by_level" FOR UPDATE USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_student_attendance_scores" FOR UPDATE USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_student_behavior_scores" FOR UPDATE USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_student_final_grades" FOR UPDATE USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_student_scores" FOR UPDATE USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."ds_teacher_attendance" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Enable update access for all users" ON "public"."service_announcements" FOR UPDATE TO "authenticated", "anon" USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."user_service_roles" FOR UPDATE USING (true);



CREATE POLICY "Enable update access for all users" ON "public"."visitation_slots" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Enable update for authenticated users only" ON "public"."visitation_reservation" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Enable update for users " ON "public"."user_tokens" FOR UPDATE USING (true);



CREATE POLICY "Enable write  access for all users" ON "public"."visitation_slots" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable write access for all users" ON "public"."ds_attendance" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable write access for all users" ON "public"."ds_course_teachers" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable write access for all users" ON "public"."ds_student_enrollment" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable write access for all users" ON "public"."hymns_folders" FOR INSERT WITH CHECK (true);



CREATE POLICY "Public profiles are viewable by everyone." ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Select Calendar" ON "public"."ds_calendar_week" FOR SELECT USING (true);



CREATE POLICY "Users can insert their own profile." ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own profile." ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own billing history" ON "public"."billing_history" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."announcments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."confession_availability_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."confessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deacons_school_altar_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deacons_school_calendar" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deacons_school_coptic" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deacons_school_hymn_hazzat" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deacons_school_hymns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deacons_school_memorization" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deacons_school_rituals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."diptych" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_assessment_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_calendar_teacher_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_calendar_week" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_class_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_coptic_lesson_by_level" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_course_teachers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_courses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_grading_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_quarters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_rituals_lesson_by_level" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_student_attendance_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_student_behavior_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_student_enrollment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_student_final_grades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_student_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_teacher_attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ds_yearly_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hymns_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."join_service_request" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_blog_article" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prayerRequests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles_table" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_announcements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_lesson" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services_table" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update" ON "public"."ds_course_teachers" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "update all" ON "public"."calendar" FOR UPDATE USING (true);



CREATE POLICY "update allowed" ON "public"."ds_calendar_week" FOR UPDATE USING (true);



CREATE POLICY "update for all" ON "public"."announcments" FOR UPDATE USING (true) WITH CHECK (true);



ALTER TABLE "public"."user_service_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visitation_reservation" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visitation_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Enable read access for all users" ON "sundaySchool"."classesInformation" FOR SELECT USING (true);



ALTER TABLE "sundaySchool"."classesInformation" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































GRANT ALL ON FUNCTION "public"."calculate_student_grade"("p_student_id" "text", "p_course_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_student_grade"("p_student_id" "text", "p_course_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_student_grade"("p_student_id" "text", "p_course_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_folders_with_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_folders_with_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_folders_with_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_students_scores_by_course"("p_course_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_students_scores_by_course"("p_course_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_students_scores_by_course"("p_course_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_user_emails"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_user_emails"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_user_emails"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_attendance_by_date_and_service"("p_date" "date", "p_service_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_attendance_by_date_and_service"("p_date" "date", "p_service_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_attendance_by_date_and_service"("p_date" "date", "p_service_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_calendar_by_course_and_date_range"("p_course_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_calendar_by_course_and_date_range"("p_course_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_calendar_by_course_and_date_range"("p_course_id" "uuid", "p_start_date" "date", "p_end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_course_students_grades"("p_course_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_course_students_grades"("p_course_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_course_students_grades"("p_course_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_week_calendar_by_course"("p_course_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_week_calendar_by_course"("p_course_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_week_calendar_by_course"("p_course_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_deacon_school_teachers"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_deacon_school_teachers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_deacon_school_teachers"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_deacons_school_extras_by_level"("level_param" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_deacons_school_extras_by_level"("level_param" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_deacons_school_extras_by_level"("level_param" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_ds_student_courses_by_portal_id"("p_user_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_ds_student_courses_by_portal_id"("p_user_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_ds_student_courses_by_portal_id"("p_user_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_ds_teacher_courses_by_portal_id"("p_user_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_ds_teacher_courses_by_portal_id"("p_user_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_ds_teacher_courses_by_portal_id"("p_user_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_ds_teachers_by_course"("p_course_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_ds_teachers_by_course"("p_course_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_ds_teachers_by_course"("p_course_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_family_children"("portal_id_in" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_family_children"("portal_id_in" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_family_children"("portal_id_in" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_item_points"("p_item_reference" character varying, "p_reference_id" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."get_item_points"("p_item_reference" character varying, "p_reference_id" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_item_points"("p_item_reference" character varying, "p_reference_id" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_profile_all_roles"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_profile_all_roles"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profile_all_roles"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_service_members_teachers_coordinators"("p_service_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_service_members_teachers_coordinators"("p_service_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_service_members_teachers_coordinators"("p_service_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_student_all_scores"("p_student_id" "text", "p_course_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_all_scores"("p_student_id" "text", "p_course_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_all_scores"("p_student_id" "text", "p_course_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_student_grade_breakdown"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_grade_breakdown"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_grade_breakdown"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_student_grade_summary"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_grade_summary"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_grade_summary"("p_student_id" "text", "p_course_id" "uuid", "p_quarter_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_student_grade_summary"("p_student_id" character varying, "p_course_id" "uuid", "p_quarter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_grade_summary"("p_student_id" character varying, "p_course_id" "uuid", "p_quarter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_grade_summary"("p_student_id" character varying, "p_course_id" "uuid", "p_quarter_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_roles_and_services"("p_user_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_roles_and_services"("p_user_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_roles_and_services"("p_user_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_into_userservice"() TO "anon";
GRANT ALL ON FUNCTION "public"."insert_into_userservice"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_into_userservice"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_all_grades"("p_course_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_all_grades"("p_course_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_all_grades"("p_course_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_calculate_student_grade"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_calculate_student_grade"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_calculate_student_grade"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_student_attendance_scores"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_student_attendance_scores"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_student_attendance_scores"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_student_behavior_scores"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_student_behavior_scores"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_student_behavior_scores"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."announcments" TO "anon";
GRANT ALL ON TABLE "public"."announcments" TO "authenticated";
GRANT ALL ON TABLE "public"."announcments" TO "service_role";



GRANT ALL ON TABLE "public"."attendance" TO "anon";
GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";



GRANT ALL ON SEQUENCE "public"."attendance_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."attendance_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."attendance_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."billing_history" TO "anon";
GRANT ALL ON TABLE "public"."billing_history" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_history" TO "service_role";



GRANT ALL ON TABLE "public"."calendar" TO "anon";
GRANT ALL ON TABLE "public"."calendar" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar" TO "service_role";



GRANT ALL ON SEQUENCE "public"."calendar_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."calendar_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."calendar_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."confession_availability_slots" TO "anon";
GRANT ALL ON TABLE "public"."confession_availability_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."confession_availability_slots" TO "service_role";



GRANT ALL ON TABLE "public"."confessions" TO "anon";
GRANT ALL ON TABLE "public"."confessions" TO "authenticated";
GRANT ALL ON TABLE "public"."confessions" TO "service_role";



GRANT ALL ON TABLE "public"."deacons_school_altar_responses" TO "anon";
GRANT ALL ON TABLE "public"."deacons_school_altar_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."deacons_school_altar_responses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."deacons_school_altar_responses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."deacons_school_altar_responses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."deacons_school_altar_responses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."deacons_school_calendar" TO "anon";
GRANT ALL ON TABLE "public"."deacons_school_calendar" TO "authenticated";
GRANT ALL ON TABLE "public"."deacons_school_calendar" TO "service_role";



GRANT ALL ON SEQUENCE "public"."deacons_school_calendar_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."deacons_school_calendar_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."deacons_school_calendar_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."deacons_school_coptic" TO "anon";
GRANT ALL ON TABLE "public"."deacons_school_coptic" TO "authenticated";
GRANT ALL ON TABLE "public"."deacons_school_coptic" TO "service_role";



GRANT ALL ON SEQUENCE "public"."deacons_school_coptic_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."deacons_school_coptic_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."deacons_school_coptic_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."deacons_school_hymn_hazzat" TO "anon";
GRANT ALL ON TABLE "public"."deacons_school_hymn_hazzat" TO "authenticated";
GRANT ALL ON TABLE "public"."deacons_school_hymn_hazzat" TO "service_role";



GRANT ALL ON TABLE "public"."deacons_school_hymn_recordings" TO "anon";
GRANT ALL ON TABLE "public"."deacons_school_hymn_recordings" TO "authenticated";
GRANT ALL ON TABLE "public"."deacons_school_hymn_recordings" TO "service_role";



GRANT ALL ON TABLE "public"."deacons_school_hymns" TO "anon";
GRANT ALL ON TABLE "public"."deacons_school_hymns" TO "authenticated";
GRANT ALL ON TABLE "public"."deacons_school_hymns" TO "service_role";



GRANT ALL ON SEQUENCE "public"."deacons_school_hymns_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."deacons_school_hymns_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."deacons_school_hymns_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."deacons_school_memorization" TO "anon";
GRANT ALL ON TABLE "public"."deacons_school_memorization" TO "authenticated";
GRANT ALL ON TABLE "public"."deacons_school_memorization" TO "service_role";



GRANT ALL ON SEQUENCE "public"."deacons_school_memorization_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."deacons_school_memorization_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."deacons_school_memorization_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."deacons_school_rituals" TO "anon";
GRANT ALL ON TABLE "public"."deacons_school_rituals" TO "authenticated";
GRANT ALL ON TABLE "public"."deacons_school_rituals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."deacons_school_rituals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."deacons_school_rituals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."deacons_school_rituals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."diptych" TO "anon";
GRANT ALL ON TABLE "public"."diptych" TO "authenticated";
GRANT ALL ON TABLE "public"."diptych" TO "service_role";



GRANT ALL ON SEQUENCE "public"."diptych_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."diptych_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."diptych_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ds_assessment_items" TO "anon";
GRANT ALL ON TABLE "public"."ds_assessment_items" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_assessment_items" TO "service_role";



GRANT ALL ON TABLE "public"."ds_attendance" TO "anon";
GRANT ALL ON TABLE "public"."ds_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_attendance" TO "service_role";



GRANT ALL ON TABLE "public"."ds_calendar_teacher_assignments" TO "anon";
GRANT ALL ON TABLE "public"."ds_calendar_teacher_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_calendar_teacher_assignments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ds_calendar_teacher_assignments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ds_calendar_teacher_assignments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ds_calendar_teacher_assignments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ds_calendar_week" TO "anon";
GRANT ALL ON TABLE "public"."ds_calendar_week" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_calendar_week" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ds_calendar_week_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ds_calendar_week_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ds_calendar_week_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ds_class_sessions" TO "anon";
GRANT ALL ON TABLE "public"."ds_class_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_class_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."ds_coptic_lesson_by_level" TO "anon";
GRANT ALL ON TABLE "public"."ds_coptic_lesson_by_level" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_coptic_lesson_by_level" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ds_coptic_lesson_by_lesson_duplicate_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ds_coptic_lesson_by_lesson_duplicate_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ds_coptic_lesson_by_lesson_duplicate_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ds_rituals_lesson_by_level" TO "anon";
GRANT ALL ON TABLE "public"."ds_rituals_lesson_by_level" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_rituals_lesson_by_level" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ds_coptic_rituals_lesson_by_lesson_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ds_coptic_rituals_lesson_by_lesson_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ds_coptic_rituals_lesson_by_lesson_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ds_course_teachers" TO "anon";
GRANT ALL ON TABLE "public"."ds_course_teachers" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_course_teachers" TO "service_role";



GRANT ALL ON TABLE "public"."ds_courses" TO "anon";
GRANT ALL ON TABLE "public"."ds_courses" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_courses" TO "service_role";



GRANT ALL ON TABLE "public"."ds_grading_categories" TO "anon";
GRANT ALL ON TABLE "public"."ds_grading_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_grading_categories" TO "service_role";



GRANT ALL ON TABLE "public"."ds_quarters" TO "anon";
GRANT ALL ON TABLE "public"."ds_quarters" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_quarters" TO "service_role";



GRANT ALL ON TABLE "public"."ds_student_attendance_scores" TO "anon";
GRANT ALL ON TABLE "public"."ds_student_attendance_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_student_attendance_scores" TO "service_role";



GRANT ALL ON TABLE "public"."ds_student_behavior_scores" TO "anon";
GRANT ALL ON TABLE "public"."ds_student_behavior_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_student_behavior_scores" TO "service_role";



GRANT ALL ON TABLE "public"."ds_student_enrollment" TO "anon";
GRANT ALL ON TABLE "public"."ds_student_enrollment" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_student_enrollment" TO "service_role";



GRANT ALL ON TABLE "public"."ds_student_final_grades" TO "anon";
GRANT ALL ON TABLE "public"."ds_student_final_grades" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_student_final_grades" TO "service_role";



GRANT ALL ON TABLE "public"."ds_student_scores" TO "anon";
GRANT ALL ON TABLE "public"."ds_student_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_student_scores" TO "service_role";



GRANT ALL ON TABLE "public"."ds_teacher_attendance" TO "anon";
GRANT ALL ON TABLE "public"."ds_teacher_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_teacher_attendance" TO "service_role";



GRANT ALL ON TABLE "public"."ds_yearly_requirements" TO "anon";
GRANT ALL ON TABLE "public"."ds_yearly_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."ds_yearly_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."hymn_folder_items" TO "anon";
GRANT ALL ON TABLE "public"."hymn_folder_items" TO "authenticated";
GRANT ALL ON TABLE "public"."hymn_folder_items" TO "service_role";



GRANT ALL ON TABLE "public"."hymns_folders" TO "anon";
GRANT ALL ON TABLE "public"."hymns_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."hymns_folders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hymns_folders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hymns_folders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hymns_folders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."join_service_request" TO "anon";
GRANT ALL ON TABLE "public"."join_service_request" TO "authenticated";
GRANT ALL ON TABLE "public"."join_service_request" TO "service_role";



GRANT ALL ON SEQUENCE "public"."join_service_request_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."join_service_request_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."join_service_request_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_blog_article" TO "anon";
GRANT ALL ON TABLE "public"."monthly_blog_article" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_blog_article" TO "service_role";



GRANT ALL ON SEQUENCE "public"."monthly_blog_article_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."monthly_blog_article_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."monthly_blog_article_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."prayerRequests" TO "anon";
GRANT ALL ON TABLE "public"."prayerRequests" TO "authenticated";
GRANT ALL ON TABLE "public"."prayerRequests" TO "service_role";



GRANT ALL ON SEQUENCE "public"."prayerRequests_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."prayerRequests_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."prayerRequests_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."roles_table" TO "anon";
GRANT ALL ON TABLE "public"."roles_table" TO "authenticated";
GRANT ALL ON TABLE "public"."roles_table" TO "service_role";



GRANT ALL ON TABLE "public"."service_announcements" TO "anon";
GRANT ALL ON TABLE "public"."service_announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."service_announcements" TO "service_role";



GRANT ALL ON TABLE "public"."service_lesson" TO "anon";
GRANT ALL ON TABLE "public"."service_lesson" TO "authenticated";
GRANT ALL ON TABLE "public"."service_lesson" TO "service_role";



GRANT ALL ON TABLE "public"."services_table" TO "anon";
GRANT ALL ON TABLE "public"."services_table" TO "authenticated";
GRANT ALL ON TABLE "public"."services_table" TO "service_role";



GRANT ALL ON TABLE "public"."user_service_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_service_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_service_roles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_service_roles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_service_roles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_service_roles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."v_attendance_pct" TO "anon";
GRANT ALL ON TABLE "public"."v_attendance_pct" TO "authenticated";
GRANT ALL ON TABLE "public"."v_attendance_pct" TO "service_role";



GRANT ALL ON TABLE "public"."visitation_reservation" TO "anon";
GRANT ALL ON TABLE "public"."visitation_reservation" TO "authenticated";
GRANT ALL ON TABLE "public"."visitation_reservation" TO "service_role";



GRANT ALL ON SEQUENCE "public"."visitation_reservation_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."visitation_reservation_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."visitation_reservation_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."visitation_slots" TO "anon";
GRANT ALL ON TABLE "public"."visitation_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."visitation_slots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."visitation_slots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."visitation_slots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."visitation_slots_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";


































drop extension if exists "pg_net";

alter table "public"."confession_availability_slots" drop constraint "confession_availability_slots_status_check";

alter table "public"."confessions" drop constraint "confessions_status_check";

alter table "public"."confession_availability_slots" add constraint "confession_availability_slots_status_check" CHECK (((status)::text = ANY ((ARRAY['available'::character varying, 'booked'::character varying, 'blocked'::character varying, 'cancelled'::character varying])::text[]))) not valid;

alter table "public"."confession_availability_slots" validate constraint "confession_availability_slots_status_check";

alter table "public"."confessions" add constraint "confessions_status_check" CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'confirmed'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'no_show'::character varying])::text[]))) not valid;

alter table "public"."confessions" validate constraint "confessions_status_check";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Enable read access for all users"
  on "storage"."buckets"
  as permissive
  for select
  to public
using (true);



  create policy "Anyone Select 2pltcp_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'announcments'::text));



  create policy "Anyone can upload 2pltcp_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check ((bucket_id = 'announcments'::text));



  create policy "Anyone can upload an avatar."
  on "storage"."objects"
  as permissive
  for insert
  to public
with check ((bucket_id = 'avatars'::text));



  create policy "Avatar images are publicly accessible."
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));



  create policy "Give anon users access to delete 2pltcp_0"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'announcments'::text) AND (auth.role() = 'anon'::text)));



  create policy "Public  Insert / Get 1lrmut8_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'deacons_school_hymns_files'::text));



  create policy "Public  Insert / Get 1lrmut8_1"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check ((bucket_id = 'deacons_school_hymns_files'::text));



  create policy "Public Insert 1vsgx6q_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check ((bucket_id = 'service_announcements'::text));



  create policy "Public view 1vsgx6q_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'service_announcements'::text));



  create policy "Update Images 2pltcp_0"
  on "storage"."objects"
  as permissive
  for update
  to public
using ((bucket_id = 'announcments'::text));



  create policy "public insert 1lrmut8_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check ((bucket_id = 'deacons_school_hymns_files'::text));



  create policy "public insert 79mycu_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check ((bucket_id = 'hymns_files_json'::text));



