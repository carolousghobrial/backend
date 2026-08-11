-- ================================================================
-- Phase 1: Year-Scope Grading Weights (freeze history, zero behavior change)
-- ================================================================
-- Run this AFTER DISCOVERY_grading_system.sql has been run and its
-- output reviewed. This migration is purely additive: it snapshots
-- today's state, creates new tables, and backfills every EXISTING
-- academic year with today's weights and legacy policy flags. Nothing
-- reads these new tables yet, so this step cannot change any grade a
-- student has already earned.
--
-- Why a side table instead of adding academic_year to
-- ds_grading_categories directly, or cloning category rows per year:
-- ds_assessment_items.category_id is a foreign key into
-- ds_grading_categories. Cloning rows per year would mint a new
-- category_id every year, forcing item-creation to resolve categories
-- by (name, year) instead of a stable id, and would make
-- GET /getGradingCategories return N duplicate "Hymns" rows across
-- years. A side table keyed on (category_id, academic_year) keeps
-- category_id stable forever and lets each year carry its own weight.
-- ================================================================

-- Step 1: Snapshot today's state, for the shadow-compare gate in
-- Phase 3 and as an instant rollback source.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ds_student_final_grades_snapshot_pre_rubric'
  ) THEN
    CREATE TABLE ds_student_final_grades_snapshot_pre_rubric AS
    SELECT *, now() AS snapshot_at FROM ds_student_final_grades;
    RAISE NOTICE 'Snapshotted % row(s) from ds_student_final_grades',
      (SELECT COUNT(*) FROM ds_student_final_grades_snapshot_pre_rubric);
  ELSE
    RAISE NOTICE 'ds_student_final_grades_snapshot_pre_rubric already exists -- not re-snapshotting. Drop it manually first if you need a fresh snapshot.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ds_grading_categories_snapshot_pre_rubric'
  ) THEN
    CREATE TABLE ds_grading_categories_snapshot_pre_rubric AS
    SELECT *, now() AS snapshot_at FROM ds_grading_categories;
    RAISE NOTICE 'Snapshotted ds_grading_categories';
  ELSE
    RAISE NOTICE 'ds_grading_categories_snapshot_pre_rubric already exists';
  END IF;
END $$;

-- Step 2: calculate_student_grade_legacy -- the rollback path for the
-- RPC rewrite in Phase 3. THIS MUST BE FILLED IN MANUALLY: paste the
-- exact function body returned by DISCOVERY_grading_system.sql query
-- #11 (pg_get_functiondef), renaming only the function name. Do not
-- proceed to Phase 3 until this function exists and returns identical
-- results to the current calculate_student_grade for every historical
-- row (that's exactly what the Phase 3 gate query checks).
--
-- Example shape (uncomment and replace with the REAL discovered body):
--
-- CREATE OR REPLACE FUNCTION calculate_student_grade_legacy(
--   p_student_id <TYPE>, p_course_id <TYPE>, p_quarter_id <TYPE>
-- ) RETURNS <RETURN TYPE FROM DISCOVERY>
-- LANGUAGE plpgsql
-- <SECURITY DEFINER IF DISCOVERY SHOWED prosecdef = true>
-- <SET search_path = ... IF DISCOVERY SHOWED ONE>
-- AS $$
--   <VERBATIM BODY FROM pg_get_functiondef(calculate_student_grade)>
-- $$;

-- Step 3: Year-scoped category weights.
DO $$
DECLARE
  v_cat_type text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ds_grading_category_weights'
  ) THEN
    RAISE NOTICE 'ds_grading_category_weights already exists';
    RETURN;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_cat_type
  FROM pg_attribute a
  WHERE a.attrelid = 'ds_grading_categories'::regclass
    AND a.attname = 'category_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_cat_type IS NULL THEN
    RAISE EXCEPTION 'Could not determine the type of ds_grading_categories.category_id -- aborting';
  END IF;

  -- pgcrypto for gen_random_uuid(); safe no-op if already installed.
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  EXECUTE format(
    $f$
      CREATE TABLE ds_grading_category_weights (
        weight_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id       %1$s NOT NULL
                          REFERENCES ds_grading_categories(category_id) ON DELETE RESTRICT,
        academic_year     varchar(9) NOT NULL
                          REFERENCES ds_academic_years(year_label)
                          ON UPDATE CASCADE ON DELETE RESTRICT,
        weight_percentage numeric(5,2) NOT NULL DEFAULT 0
                          CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        is_active         boolean NOT NULL DEFAULT true,
        created_at        timestamptz NOT NULL DEFAULT now(),
        created_by        text,
        CONSTRAINT uq_ds_grading_category_weights UNIQUE (category_id, academic_year)
      )
    $f$,
    v_cat_type
  );

  RAISE NOTICE 'Created ds_grading_category_weights (category_id type: %)', v_cat_type;
END $$;

CREATE INDEX IF NOT EXISTS idx_ds_grading_category_weights_year
  ON ds_grading_category_weights(academic_year);

-- Step 4: Year-scoped grading policy (passing grade, attendance floor,
-- late-test parameters). One row per academic year.
CREATE TABLE IF NOT EXISTS ds_grading_policy (
  academic_year             varchar(9) PRIMARY KEY
                            REFERENCES ds_academic_years(year_label)
                            ON UPDATE CASCADE ON DELETE RESTRICT,
  passing_percentage        numeric(5,2) NOT NULL DEFAULT 60,
  min_attendance_percentage numeric(5,2) NOT NULL DEFAULT 50,
  late_policy_enabled       boolean      NOT NULL DEFAULT false,
  late_first_week_cap       numeric(5,2) NOT NULL DEFAULT 85,
  late_weekly_drop          numeric(5,2) NOT NULL DEFAULT 15,
  late_grace_days           integer      NOT NULL DEFAULT 0,
  renormalize_partial       boolean      NOT NULL DEFAULT false,
  notes                     text,
  updated_at                timestamptz  NOT NULL DEFAULT now()
);

-- Step 5: Backfill EVERY existing academic year with today's weights
-- and legacy (inert) policy flags. This is what guarantees a
-- historical year computes to the exact same numbers it always has.
INSERT INTO ds_grading_category_weights (category_id, academic_year, weight_percentage, is_active, created_by)
SELECT gc.category_id, y.year_label, gc.weight_percentage, gc.is_active, 'migration:freeze_history'
FROM ds_grading_categories gc
CROSS JOIN (
  SELECT DISTINCT academic_year AS year_label FROM ds_student_final_grades WHERE academic_year IS NOT NULL
  UNION
  SELECT DISTINCT academic_year FROM ds_courses WHERE academic_year IS NOT NULL
) y
ON CONFLICT (category_id, academic_year) DO NOTHING;

INSERT INTO ds_grading_policy (academic_year, notes)
SELECT year_label, 'legacy behavior frozen by add_year_scoped_grading_weights.sql'
FROM ds_academic_years
ON CONFLICT (academic_year) DO NOTHING;

-- Step 6: Display metadata for the Attendance & Behavior presentation
-- merge -- two 10% categories shown as one "Attendance & Behavior 20%"
-- block. Purely cosmetic; ds_grading_categories is read-only from the
-- app today (only GET /getGradingCategories), so adding display-only
-- columns here is safe.
ALTER TABLE ds_grading_categories ADD COLUMN IF NOT EXISTS display_group varchar(60);
ALTER TABLE ds_grading_categories ADD COLUMN IF NOT EXISTS display_order integer;

UPDATE ds_grading_categories SET display_group = 'Attendance & Behavior', display_order = 10
  WHERE lower(category_name) IN ('attendance', 'behavior') AND display_group IS NULL;
UPDATE ds_grading_categories SET display_group = 'Hymns', display_order = 20
  WHERE lower(category_name) = 'hymns' AND display_group IS NULL;
UPDATE ds_grading_categories SET display_group = 'Coptic', display_order = 30
  WHERE lower(category_name) = 'coptic' AND display_group IS NULL;
UPDATE ds_grading_categories SET display_group = 'Rituals', display_order = 40
  WHERE lower(category_name) = 'rituals' AND display_group IS NULL;
UPDATE ds_grading_categories SET display_group = 'Memorization', display_order = 50
  WHERE lower(category_name) = 'memorization' AND display_group IS NULL;
UPDATE ds_grading_categories SET display_group = 'Altar Responses', display_order = 60
  WHERE lower(category_name) LIKE '%altar%' AND display_group IS NULL;

-- Mark the legacy column so nobody edits it directly by accident once
-- the year-scoped table is live. Do NOT change its values yet -- that
-- happens in Phase 4, only for the new year, via the weights table.
COMMENT ON COLUMN ds_grading_categories.weight_percentage IS
  'DEPRECATED as of the year-scoped grading migration -- display default / legacy fallback only. Authoritative weights live in ds_grading_category_weights, one row per (category_id, academic_year).';

-- ================================================================
-- Verification Queries
-- ================================================================

-- Every existing year should show the SAME active-weight total it had
-- before this migration ran (compare to
-- ds_grading_categories_snapshot_pre_rubric).
SELECT academic_year, SUM(weight_percentage) AS active_weight_total, COUNT(*) AS active_categories
FROM ds_grading_category_weights
WHERE is_active
GROUP BY academic_year
ORDER BY academic_year DESC;

-- Side-by-side: snapshot vs backfilled weights per category, should match.
SELECT
  s.category_name,
  s.weight_percentage AS snapshot_weight,
  w.academic_year,
  w.weight_percentage AS backfilled_weight
FROM ds_grading_categories_snapshot_pre_rubric s
JOIN ds_grading_category_weights w ON w.category_id = s.category_id
ORDER BY w.academic_year DESC, s.category_name;

SELECT * FROM ds_grading_policy ORDER BY academic_year DESC;

SELECT category_id, category_name, display_group, display_order
FROM ds_grading_categories
ORDER BY display_order NULLS LAST, category_name;

-- ================================================================
-- Rollback Script (if needed)
-- ================================================================
-- DROP TABLE IF EXISTS ds_grading_category_weights;
-- DROP TABLE IF EXISTS ds_grading_policy;
-- ALTER TABLE ds_grading_categories DROP COLUMN IF EXISTS display_group;
-- ALTER TABLE ds_grading_categories DROP COLUMN IF EXISTS display_order;
-- COMMENT ON COLUMN ds_grading_categories.weight_percentage IS NULL;
-- -- Snapshots (ds_*_snapshot_pre_rubric) are left in place deliberately;
-- -- drop them manually only once you're certain you no longer need them:
-- -- DROP TABLE IF EXISTS ds_student_final_grades_snapshot_pre_rubric;
-- -- DROP TABLE IF EXISTS ds_grading_categories_snapshot_pre_rubric;
