/**
 * services.js  — Express router
 *
 * Fixes vs original:
 *  - /addUserRole: inserts `portal_id` (was already correct in DB insert,
 *    but the route now also accepts `user_id` as an alias for compatibility)
 *  - /updateUserRoleService: removed reference to undefined `userServiceRoles`
 *  - /updateDSTeacherCourse: removed reference to undefined `userServiceRoles`
 *  - /getUserServiceRoles: queries by `portal_id` (matches the DB column)
 *  - /deleteUserRole: added missing endpoint
 *  - All 500 responses now return JSON { success, message } instead of plain text
 *  - Added /addDSTeacher for completeness
 */
const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const moment = require("moment-timezone");
const axios = require("axios");

app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ok = (res, data) => res.json(data);
const err = (res, error, status = 500) => {
  console.error("[services]", error);
  res
    .status(status)
    .json({ success: false, message: error?.message ?? String(error) });
};

// ══════════════════════════════════════════════════════════════════════════════
// USER ROLES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /addUserRole
 * Body: { portal_id | user_id, role_id, service_id }
 * (accepts user_id as alias so existing callers don't break)
 */
app.post("/addUserRole", async (req, res) => {
  const portal_id = req.body.portal_id ?? req.body.user_id;
  const { role_id, service_id } = req.body;

  if (!portal_id || !role_id || !service_id) {
    return res
      .status(400)
      .json({
        success: false,
        message: "portal_id, role_id, and service_id are required",
      });
  }

  const { data, error } = await supabase.supabase
    .from("user_service_roles")
    .insert([{ portal_id, role_id, service_id }])
    .select()
    .single();

  if (error) return err(res, error);
  ok(res, { success: true, data });
});

/**
 * POST /addUserRoleBulk
 * Body: { users: string[], role_id, service_id }
 */
app.post("/addUserRoleBulk", async (req, res) => {
  const { users, role_id, service_id } = req.body;

  if (!Array.isArray(users) || users.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "users must be a non-empty array" });
  }
  if (!role_id || !service_id) {
    return res
      .status(400)
      .json({ success: false, message: "role_id and service_id are required" });
  }

  const rows = users.map((portal_id) => ({ portal_id, role_id, service_id }));

  const { data, error } = await supabase.supabase
    .from("user_service_roles")
    .insert(rows)
    .select();

  if (error) return err(res, error);

  ok(res, {
    success: true,
    message: `Successfully added ${data?.length ?? rows.length} role assignments`,
    inserted_count: data?.length ?? rows.length,
    data,
  });
});

/**
 * POST /updateUserRoleService
 * Body: { user_id, role_id, service_id }
 * FIX: removed reference to undefined variable `userServiceRoles`
 */
app.post("/updateUserRoleService", async (req, res) => {
  const { user_id, role_id, service_id } = req.body;

  if (!user_id || !role_id || !service_id) {
    return res
      .status(400)
      .json({
        success: false,
        message: "user_id, role_id, and service_id are required",
      });
  }

  const { data, error } = await supabase.supabase
    .from("user_service_roles")
    .update({ service_id })
    .eq("user_id", user_id)
    .eq("role_id", role_id)
    .select();

  if (error) return err(res, error);

  ok(res, {
    success: true,
    message: `Updated ${data?.length ?? 0} role assignment(s)`,
    updated_count: data?.length ?? 0,
    data,
  });
});

/**
 * DELETE /deleteUserRole/:serviceRoleId
 */
app.delete("/deleteUserRole/:serviceRoleId", async (req, res) => {
  const { serviceRoleId } = req.params;
  if (!serviceRoleId) {
    return res
      .status(400)
      .json({ success: false, message: "serviceRoleId is required" });
  }

  const { error } = await supabase.supabase
    .from("user_service_roles")
    .delete()
    .eq("id", serviceRoleId);

  if (error) return err(res, error);
  ok(res, { success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// READ — Services
// ══════════════════════════════════════════════════════════════════════════════

app.get("/getServices", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("services_table")
    .select("*")
    .not("service_id", "ilike", "%ds_level%");
  if (error) return err(res, error);
  ok(res, data);
});

app.get("/getServiceById/:id", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("services_table")
    .select("*")
    .eq("service_id", req.params.id)
    .single();
  if (error) return err(res, error);
  ok(res, data);
});

app.get("/getRoles", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("roles_table")
    .select("*");
  if (error) return err(res, error);
  ok(res, data);
});

app.get("/getDeaconsSchoolClasses", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("ds_courses")
    .select("*");
  if (error) return err(res, error);
  ok(res, data);
});

// ══════════════════════════════════════════════════════════════════════════════
// READ — User roles & members
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /getUserServiceRoles/:portal_id
 * FIX: query by portal_id (matches DB column, not user_id)
 */
app.get("/getUserServiceRoles/:portal_id", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("user_service_roles")
    .select("*")
    .eq("portal_id", req.params.portal_id);
  if (error) return err(res, error);
  ok(res, data);
});

app.get("/getServiceServants/:service_id", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("user_service_roles")
    .select("*")
    .eq("service_id", req.params.service_id)
    .not("role_id", "in", '("congregant","member")');
  if (error) return err(res, error);
  ok(res, data);
});

app.get("/getServiceMembers/:service_id", async (req, res) => {
  const { data, error } = await supabase.supabase.rpc(
    "get_service_members_teachers_coordinators",
    { p_service_id: req.params.service_id },
  );
  if (error) return err(res, error);
  ok(res, data);
});

// ══════════════════════════════════════════════════════════════════════════════
// READ — Lessons
// ══════════════════════════════════════════════════════════════════════════════

app.get("/getServiceLessons/:serviceId", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("service_lesson")
    .select("*")
    .eq("service", req.params.serviceId)
    .order("date_of_lesson", { ascending: false });
  if (error) return err(res, error);
  ok(res, data);
});

app.get("/getServiceLessonOfWeek/:serviceId", async (req, res) => {
  try {
    const startOfWeek = moment().tz("America/Chicago").startOf("week");
    const endOfWeek = moment().tz("America/Chicago").endOf("week");
    const { data, error } = await supabase.supabase
      .from("service_lesson")
      .select("*")
      .eq("service", req.params.serviceId)
      .gte("date_of_lesson", startOfWeek.toISOString())
      .lte("date_of_lesson", endOfWeek.toISOString())
      .single();
    if (error) return err(res, error);
    ok(res, data);
  } catch (e) {
    err(res, e);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// WRITE — Lessons
// ══════════════════════════════════════════════════════════════════════════════

app.post("/addserviceLesson", async (req, res) => {
  const lesson = {
    service: req.body.service,
    title: req.body.title,
    description: req.body.description,
    verse: req.body.verse,
    date_of_lesson: req.body.date_of_lesson,
    assignee: req.body.assignee,
  };

  if (!lesson.service || !lesson.title) {
    return res
      .status(400)
      .json({ success: false, message: "service and title are required" });
  }

  const { data, error } = await supabase.supabase
    .from("service_lesson")
    .insert([lesson])
    .select()
    .single();

  if (error) return err(res, error);

  // Push notification — fire-and-forget, don't let it fail the response
  try {
    await axios.post(
      `http://localhost:3000/notifications/sendSubscribedServicePushNotification/${lesson.service}`,
      { title: "New Lesson Posted", body: lesson.title },
    );
  } catch (notifErr) {
    console.warn(
      "[services] Push notification failed (non-fatal):",
      notifErr.message,
    );
  }

  ok(res, { success: true, data });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS Teachers
// ══════════════════════════════════════════════════════════════════════════════

app.get("/getDSTeachers", async (req, res) => {
  const { data, error } = await supabase.supabase.rpc(
    "get_deacon_school_teachers",
  );
  if (error) return err(res, error);
  ok(res, data);
});

app.get("/getDSTeachersByCourse/:course_id", async (req, res) => {
  const { data, error } = await supabase.supabase.rpc(
    "get_ds_teachers_by_course",
    {
      p_course_id: req.params.course_id,
    },
  );
  if (error) return err(res, error);
  ok(res, data);
});

/**
 * POST /updateDSTeacherCourse
 * FIX: removed reference to undefined variable `userServiceRoles`
 */
app.post("/updateDSTeacherCourse", async (req, res) => {
  const { teacher_id, role_id, course_id } = req.body;

  if (!teacher_id || !role_id || !course_id) {
    return res
      .status(400)
      .json({
        success: false,
        message: "teacher_id, role_id, and course_id are required",
      });
  }

  const { data, error } = await supabase.supabase
    .from("ds_course_teachers")
    .update({ course_id })
    .eq("teacher_id", teacher_id)
    .eq("role", role_id)
    .select();

  if (error) return err(res, error);

  ok(res, {
    success: true,
    message: `Updated ${data?.length ?? 0} teacher assignment(s)`,
    updated_count: data?.length ?? 0,
    data,
  });
});

/**
 * DELETE /deleteDSTeacher
 * Body: { teacher_id, course_id }
 */
app.delete("/deleteDSTeacher", async (req, res) => {
  const { teacher_id, course_id } = req.body;

  if (!teacher_id || !course_id) {
    return res
      .status(400)
      .json({
        success: false,
        message: "teacher_id and course_id are required",
      });
  }

  const { data, error } = await supabase.supabase
    .from("ds_course_teachers")
    .delete()
    .match({ teacher_id, course_id })
    .select();

  if (error) return err(res, error);
  if (!data?.length)
    return res
      .status(404)
      .json({ success: false, message: "No matching record found" });

  ok(res, { success: true, deleted: data.length });
});

/**
 * POST /addDSTeacher
 * Body: { teacher_id, course_id, role }
 */
app.post("/addDSTeacher", async (req, res) => {
  const { teacher_id, course_id, role } = req.body;
  if (!teacher_id || !course_id) {
    return res
      .status(400)
      .json({
        success: false,
        message: "teacher_id and course_id are required",
      });
  }

  const { data, error } = await supabase.supabase
    .from("ds_course_teachers")
    .insert([{ teacher_id, course_id, role: role ?? "teacher" }])
    .select()
    .single();

  if (error) return err(res, error);
  ok(res, { success: true, data });
});

module.exports = app;
