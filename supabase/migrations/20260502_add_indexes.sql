-- =============================================================================
-- St. George COC Nashville — Database Performance Indexes
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- Safe to run multiple times — all use IF NOT EXISTS
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- ANNOUNCEMENTS
-- Queries: order by created_at, filter valid, filter service_id
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_announcments_created_at
  ON announcments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcments_valid_created_at
  ON announcments (valid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_announcements_service_id_valid
  ON service_announcements (service_id, valid);


-- ─────────────────────────────────────────────────────────────────────────────
-- ATTENDANCE (church services)
-- Queries: (portal_id, date, service_id) uniqueness check, date range scans
-- ─────────────────────────────────────────────────────────────────────────────

-- Composite: used for the "already exists?" check before insert
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_portal_date_service
  ON attendance (portal_id, date, service_id);

-- Date range queries with optional service_id filter
CREATE INDEX IF NOT EXISTS idx_attendance_date_service
  ON attendance (date, service_id);

-- export / stats queries ordered by date + timestamp
CREATE INDEX IF NOT EXISTS idx_attendance_date_timestamp
  ON attendance (date DESC, timestamp);


-- ─────────────────────────────────────────────────────────────────────────────
-- CALENDAR
-- Queries: filter by eventDay
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_calendar_event_day
  ON calendar ("eventDay");


-- ─────────────────────────────────────────────────────────────────────────────
-- PROFILES
-- Queries: .eq("id"), .eq("portal_id"), .eq("email"), .eq("family_id")
-- ─────────────────────────────────────────────────────────────────────────────

-- portal_id is heavily used as a cross-table join key
CREATE INDEX IF NOT EXISTS idx_profiles_portal_id
  ON profiles (portal_id);

CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON profiles (email);

CREATE INDEX IF NOT EXISTS idx_profiles_family_id
  ON profiles (family_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — HYMNS
-- Queries: filter level_hymn_in, folder_id, order_taught
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_hymns_level
  ON deacons_school_hymns (level_hymn_in);

CREATE INDEX IF NOT EXISTS idx_ds_hymns_folder_order
  ON deacons_school_hymns (folder_id, order_taught);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — HYMN RECORDINGS & HAZZAT
-- Queries: filter by hymn_id, order by created_at
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_hymn_recordings_hymn_id
  ON deacons_school_hymn_recordings (hymn_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ds_hymn_hazzat_hymn_id
  ON deacons_school_hymn_hazzat (hymn_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — ALTAR RESPONSES, RITUALS, COPTIC, MEMORIZATION
-- Queries: .eq("level") on all of these
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_altar_responses_level
  ON deacons_school_altar_responses (level);

CREATE INDEX IF NOT EXISTS idx_ds_rituals_level
  ON deacons_school_rituals (level);

CREATE INDEX IF NOT EXISTS idx_ds_coptic_level
  ON deacons_school_coptic (level);

CREATE INDEX IF NOT EXISTS idx_ds_memorization_level
  ON deacons_school_memorization (level);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — COURSES
-- Queries: .eq("level"), .eq("course_id")
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_courses_level
  ON ds_courses (level);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — CLASS SESSIONS
-- Queries: (course_id, session_date), date range
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_class_sessions_course_date
  ON ds_class_sessions (course_id, session_date);

CREATE INDEX IF NOT EXISTS idx_ds_class_sessions_date_range
  ON ds_class_sessions (session_date);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — ATTENDANCE
-- Queries: (student_id, session_id, course_id, present)
-- ─────────────────────────────────────────────────────────────────────────────

-- Most common: all attendance for a session
CREATE INDEX IF NOT EXISTS idx_ds_attendance_session_id
  ON ds_attendance (session_id);

-- Student history view
CREATE INDEX IF NOT EXISTS idx_ds_attendance_student_course
  ON ds_attendance (student_id, course_id);

-- Filter by present + course (stats / reports)
CREATE INDEX IF NOT EXISTS idx_ds_attendance_course_present
  ON ds_attendance (course_id, present);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — COURSE TEACHERS
-- Queries: (course_id, is_active), (teacher_id, course_id)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_course_teachers_course_active
  ON ds_course_teachers (course_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ds_course_teachers_teacher_course
  ON ds_course_teachers (teacher_id, course_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — STUDENT ENROLLMENT
-- Queries: (course_id, is_active), (student_id, course_id)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_enrollment_course_active
  ON ds_student_enrollment (course_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ds_enrollment_student_course
  ON ds_student_enrollment (student_id, course_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — ASSESSMENT ITEMS
-- Queries: (course_id, is_active), (category_id, course_id, is_active)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_assessment_items_course_active
  ON ds_assessment_items (course_id, is_active);

CREATE INDEX IF NOT EXISTS idx_ds_assessment_items_category_course_active
  ON ds_assessment_items (category_id, course_id, is_active);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — STUDENT SCORES
-- Queries: (student_id, course_id, quarter_id, item_id) — also the UNIQUE conflict key
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_ds_student_scores_unique
  ON ds_student_scores (student_id, course_id, quarter_id, item_id);

-- Read all scores for a student in a course/quarter
CREATE INDEX IF NOT EXISTS idx_ds_student_scores_course_quarter
  ON ds_student_scores (course_id, quarter_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — GRADING CATEGORIES & QUARTERS
-- Queries: .eq("is_active")
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_grading_categories_active
  ON ds_grading_categories (is_active);

CREATE INDEX IF NOT EXISTS idx_ds_quarters_active_start
  ON ds_quarters (is_active, start_date DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- DEACONS SCHOOL — STUDENT FINAL GRADES
-- Queries: (student_id, course_id)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ds_final_grades_student_course
  ON ds_student_final_grades (student_id, course_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- USER SERVICE ROLES
-- Queries: .eq("portal_id"), .eq("service_id")
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_service_roles_portal_id
  ON user_service_roles (portal_id);

CREATE INDEX IF NOT EXISTS idx_user_service_roles_service_id
  ON user_service_roles (service_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- SERVICE LESSONS
-- Queries: .eq("service"), order by date_of_lesson, date range
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_service_lesson_service_date
  ON service_lesson (service, date_of_lesson DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- CONFESSIONS
-- Queries: (user_id, status, dates), (priest_id), availability (status, slot_date)
-- ─────────────────────────────────────────────────────────────────────────────

-- Most common read: confessions by user + status
CREATE INDEX IF NOT EXISTS idx_confessions_user_status
  ON confessions (user_id, status, confession_date);

CREATE INDEX IF NOT EXISTS idx_confessions_priest_date
  ON confessions (priest_id, confession_date);

-- Date range filtering
CREATE INDEX IF NOT EXISTS idx_confessions_date
  ON confessions (confession_date);

-- Availability slots: most common is available + date ordered
CREATE INDEX IF NOT EXISTS idx_confession_slots_status_date
  ON confession_availability_slots (status, slot_date, start_time);


-- ─────────────────────────────────────────────────────────────────────────────
-- VISITATIONS
-- Queries: available slots, date+time ordering, confirmed/rejected status
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_visitation_slots_available_date
  ON visitation_slots (available, date, start_time);

-- Reservations filtered by confirmed status
CREATE INDEX IF NOT EXISTS idx_visitation_reservation_confirmed
  ON visitation_reservation (confirmed);


-- ─────────────────────────────────────────────────────────────────────────────
-- USER TOKENS (push notifications)
-- Queries: .eq("token"), .eq("generalNotificationsAllowed"), .contains("service_subscribed")
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tokens_token
  ON user_tokens (token);

CREATE INDEX IF NOT EXISTS idx_user_tokens_general_notifications
  ON user_tokens ("generalNotificationsAllowed");


-- ─────────────────────────────────────────────────────────────────────────────
-- MONTHLY BLOG ARTICLES
-- Queries: .eq("view_month")
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_monthly_blog_view_month
  ON monthly_blog_article (view_month);


-- ─────────────────────────────────────────────────────────────────────────────
-- DS CALENDAR WEEK
-- Queries: .contains("courses_id"), UPSERT on (calendar_day, level)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_ds_calendar_week_day_level
  ON ds_calendar_week (calendar_day, level);


-- =============================================================================
-- END OF MIGRATION
-- After applying, run ANALYZE to update query planner statistics:
-- ANALYZE;
-- =============================================================================
