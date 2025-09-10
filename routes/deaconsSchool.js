const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const daysOfWeek = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/getEvent/:id", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .eq("id", req.params.id);
  res.send(deacons_school_hymns);
});
app.get("/", (req, res) => {
  res.send("Hello, Announcment!");
});
app.get("/getHymns", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*");

  res.send(deacons_school_hymns);
});
app.get("/getCourses", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("ds_courses")
    .select("*");

  res.send(deacons_school_hymns);
});
app.get("/getHymnsByLevel/:level", async (req, res) => {
  const level = req.params.level;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .eq("level_hymn_in", level);
  res.send(data);
});
app.get("/getHymn/:id", async (req, res) => {
  const id = req.params.id;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .eq("id", id)
    .single();

  res.send(data);
});
app.get("/getRitualsByLevel/:level", async (req, res) => {
  const level = req.params.level;
  console.log(level);
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_rituals")
    .select("*")
    .eq("level", level);

  res.send(data);
  //res.ok();
});
app.get("/getCopticByLevel/:level", async (req, res) => {
  const level = req.params.level;
  console.log(level);
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_rituals")
    .select("*")
    .eq("level", level);

  res.send(data);
  //res.ok();
});
app.get("/getAltarResponses", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("deacons_school_altar_responses")
    .select("*");

  res.send(deacons_school_hymns);
});
app.get("/getAltarResponsesByLevel/:level", async (req, res) => {
  const level = req.params.level;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_altar_responses")
    .select("*")
    .eq("level", level);

  res.send(data);
  //res.ok();
});
app.get("/getAltarResponse/:id", async (req, res) => {
  const id = req.params.id;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_altar_responses")
    .select("*")
    .eq("id", id)
    .single();

  res.send(data);
});
app.get("/getMyCoursesTaught/:id", async (req, res) => {
  const portal_id = req.params.id;
  const { data, error } = await supabase.supabase.rpc(
    "get_ds_teacher_courses_by_portal_id",
    {
      p_user_id: portal_id,
    }
  );
  console.log(data);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.post("/addCoursesToCalendar", async (req, res) => {
  const levelMap = {
    1: "ds_level_alpha",
    2: "ds_level_beta",
    3: "ds_level_1",
    4: "ds_level_2",
    5: "ds_level_3",
    6: "ds_level_4",
    7: "ds_level_5",
    8: "ds_level_6",
    9: "ds_level_7",
    10: "ds_level_8",
    11: "ds_level_9",
    12: "ds_level_10",
    13: "ds_level_graduates",
    14: "ds_level_graduates",
  };

  try {
    const results = [];

    for (let index = 1; index <= 14; index++) {
      const level = levelMap[index];
      console.log(`Updating index ${index} to ${level}`);

      // Get all courses for this level
      const { data: courses, error: coursesError } = await supabase.supabase
        .from("ds_courses")
        .select("course_id")
        .eq("level", level);

      if (coursesError) {
        console.error(`Error fetching courses for ${level}:`, coursesError);
        results.push({ level, error: coursesError.message });
        continue; // skip this level, move to next
      }

      if (!courses || courses.length === 0) {
        console.warn(`No courses found for ${level}`);
        results.push({ level, message: "No courses found" });
        continue;
      }

      // Extract course_ids into an array
      const courseIds = courses.map((c) => c.course_id);
      console.log(`Course IDs for ${level}:`, courseIds);

      // Update calendar with array of course_ids
      const { data: updateData, error: updateError } = await supabase.supabase
        .from("ds_calendar_week")
        .update({
          courses_id: courseIds, // assumes courses_id column is an array type
        })
        .eq("level", level)
        .select();

      if (updateError) {
        console.error(`Error updating calendar for ${level}:`, updateError);
        results.push({ level, error: updateError.message });
      } else {
        results.push({ level, updated: updateData });
      }
    }

    // Return all results after loop finishes
    return res.json(results);
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/getStudentCourses/:id", async (req, res) => {
  const portal_id = req.params.id;
  const { data, error } = await supabase.supabase.rpc(
    "get_ds_student_courses_by_portal_id",
    {
      p_user_id: portal_id,
    }
  );
  console.log(data);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getMemorization", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("deacons_school_memorization")
    .select("*");

  res.send(deacons_school_hymns);
});
app.get("/getMemorizationByLevel/:level", async (req, res) => {
  const level = req.params.level;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_memorization")
    .select()
    .eq("level", level);
  console.log(data);
  res.send(data);
  //res.ok();
});
app.get("/getMemorization/:id", async (req, res) => {
  const id = req.params.id;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_memorization")
    .select("*")
    .eq("id", id)
    .single();

  console.log(data);
  res.send(data);
});
app.get("/getdeaconsschoolextrasbycourse/:course_id", async (req, res) => {
  const course_id = req.params.course_id;

  try {
    // Step 1: get course level from ds_courses
    const { data: courseData, error: courseError } = await supabase.supabase
      .from("ds_courses")
      .select("level")
      .eq("course_id", course_id)
      .single(); // since course_id is unique

    if (courseError) {
      console.error("Error fetching course level:", courseError);
      return res.status(500).json({ error: courseError.message });
    }

    if (!courseData) {
      return res.status(404).json({ message: "No course found with that ID" });
    }

    const level = courseData.level;

    // Step 2: call your RPC function with the level
    const { data: extrasData, error: extrasError } =
      await supabase.supabase.rpc("get_deacons_school_extras_by_level", {
        level_param: level,
      });

    if (extrasError) {
      console.error("Error fetching extras:", extrasError);
      return res.status(500).json({ error: extrasError.message });
    }

    return res.json(extrasData);
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/addDSCalendarForLevel/:level", async (req, res) => {
  const level = req.params.level;

  const calendarRow = {
    hymn_id: req.body.hymn_id,
    calendar_day: req.body.calendar_day,
    week_num: req.body.week_num,
    others_id: req.body.others_id,
    others_tablename: req.body.others_tablename,
    teacher_id: req.body.teacher_id,
    level: level,
  };
  console.log(calendarRow);
  const { data, error } = await supabase.supabase
    .from("ds_calendar_week")
    .upsert(
      [calendarRow],
      { onConflict: ["calendar_day", "level"] } // Ensures uniqueness
    )
    .select();
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.post("/addDSTeacher", async (req, res) => {
  try {
    const { teacher_id, course_id, role } = req.body;

    // Validate required fields
    if (!teacher_id || !course_id) {
      return res.status(400).json({
        error: "teacher_id and course_id are required",
      });
    }

    // Check if teacher is already assigned to this course
    const { data: existing, error: checkError } = await supabase.supabase
      .from("ds_course_teachers")
      .select("*")
      .eq("teacher_id", teacher_id)
      .eq("course_id", course_id);

    if (checkError) {
      console.error("Error checking existing assignment:", checkError);
      return res.status(500).json({ error: checkError.message });
    }

    if (existing && existing.length > 0) {
      // Teacher already assigned, update their role and make active
      const { data, error } = await supabase.supabase
        .from("ds_course_teachers")
        .update({
          role: role,
          is_active: true,
          assigned_date: new Date().toISOString().split("T")[0],
        })
        .eq("teacher_id", teacher_id)
        .eq("course_id", course_id)
        .select();

      if (error) {
        console.error("Supabase update error:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        message: "Teacher assignment updated successfully",
        data: data,
      });
    } else {
      // New assignment
      const body = {
        teacher_id: teacher_id,
        course_id: course_id,
        role: role,
        assigned_date: new Date().toISOString().split("T")[0],
        is_active: true,
      };

      console.log("Inserting teacher assignment:", body);

      const { data, error } = await supabase.supabase
        .from("ds_course_teachers")
        .insert([body])
        .select();

      if (error) {
        console.error("Supabase insert error:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        message: "Teacher assigned successfully",
        data: data,
      });
    }
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Get students enrolled in a specific course
 * GET /getStudentsByCourse/:courseId
 */
app.get("/getStudentsByCourse/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: "Course ID is required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_student_enrollment")
      .select(
        `    course_id,
      is_active,
      role,
      profiles:student_id (
        portal_id,
        first_name,
        last_name,
        email,
        cellphone
      )`
      )
      .eq("course_id", courseId)
      .eq("is_active", true)
      .order("profiles(first_name)", { ascending: true });
    console.log(data);
    if (error) {
      console.error("Error fetching students:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
    console.log(data);
    // Transform data to match frontend interface
    const students = data.map((enrollment) => ({
      portal_id: enrollment.profiles.portal_id,
      first_name: enrollment.profiles.first_name || "",
      last_name: enrollment.profiles.last_name || "",
      email: enrollment.profiles.email,
      enrollment_id: enrollment.enrollment_id,
      is_active: enrollment.is_active,
    }));

    res.json({
      success: true,
      data: students,
      count: students.length,
    });
  } catch (error) {
    console.error("Get students by course error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Get class session for specific course and date
 * GET /getClassSession/:courseId/:date
 */
app.get("/getClassSession/:courseId/:date", async (req, res) => {
  try {
    const { courseId, date } = req.params;

    if (!courseId || !date) {
      return res.status(400).json({
        success: false,
        error: "Course ID and date are required",
      });
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_class_sessions")
      .select("*")
      .eq("course_id", courseId)
      .eq("session_date", date)
      .single();
    console.log(data);
    if (error && error.code !== "PGRST116") {
      console.error("Error fetching class session:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
    res.send(data);

    // PGRST116 means no rows found, which is normal for new sessions
  } catch (error) {
    console.error("Get class session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Get attendance records for a specific session
 * GET /getAttendanceBySession/:sessionId
 */
app.get("/getAttendanceBySession/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "Session ID is required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_attendance")
      .select(
        `
        *,
        users:student_id (
          id,
          first_name,
          last_name,
          email
        ),
        ds_class_sessions:session_id (
          session_id,
          course_id,
          session_date,
          topic
        )
      `
      )
      .eq("session_id", sessionId)
      .order("users(first_name)", { ascending: true });
    console.log(data);
    if (error) {
      console.error("Error fetching attendance records:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // Transform data to match AttendanceRecord class
    const attendanceRecords = data.map((record) => ({
      student_id: record.student_id,
      session_id: record.session_id,
      present: record.present,
      good_behavior: record.good_behavior,
      notes: record.notes,
      recorded_by: record.recorded_by,
      recorded_at: record.recorded_at,
      updated_at: record.updated_at,
      student: record.users
        ? {
            id: record.users.id,
            first_name: record.users.first_name,
            last_name: record.users.last_name,
            email: record.users.email,
          }
        : null,
      session: record.ds_class_sessions
        ? {
            session_id: record.ds_class_sessions.session_id,
            course_id: record.ds_class_sessions.course_id,
            session_date: record.ds_class_sessions.session_date,
            topic: record.ds_class_sessions.topic,
          }
        : null,
    }));

    res.json({
      success: true,
      data: attendanceRecords,
      count: attendanceRecords.length,
    });
  } catch (error) {
    console.error("Get attendance by session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});
/**
 * Create new attendance session with records
 * POST /createAttendance
 */
app.post("/createAttendance", async (req, res) => {
  try {
    const {
      course_id,
      session_date,
      topic,
      notes,
      recorded_by,
      attendance_records,
    } = req.body;

    // Validation
    if (!course_id || !session_date || !Array.isArray(attendance_records)) {
      return res.status(400).json({
        success: false,
        error: "Course ID, session date, and attendance records are required",
      });
    }

    if (attendance_records.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one attendance record is required",
      });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session_date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    // First, create the class session
    const sessionBody = {
      course_id: course_id,
      session_date: session_date,
      topic: topic || null,
      notes: notes || null,
      recorded_by: recorded_by,
      created_at: new Date().toISOString(),
    };

    console.log("Creating session with data:", sessionBody);

    const { data: sessionData, error: sessionError } = await supabase.supabase
      .from("ds_class_sessions")
      .insert([sessionBody])
      .select()
      .single();

    if (sessionError) {
      console.error("Error creating session:", sessionError);
      return res.status(500).json({
        success: false,
        error: "Failed to create class session",
        details: sessionError.message,
      });
    }

    console.log("Session created:", sessionData);

    // Validate and prepare attendance records
    const validatedRecords = [];
    for (const record of attendance_records) {
      if (!record.student_id || record.present === undefined) {
        return res.status(400).json({
          success: false,
          error:
            "Each attendance record must have student_id and present status",
        });
      }
      console.log(course_id);
      validatedRecords.push({
        course_id: course_id,
        student_id: record.student_id,
        session_id: sessionData.session_id, // Use the created session ID
        good_behavior: record.good_behavior, // Use 'present' field, not 'status'
        present: record.present, // Use 'present' field, not 'status'
        notes: record.notes || null,
        recorded_by: recorded_by,
        recorded_at: new Date().toISOString(),
      });
    }

    console.log("Creating attendance records:", validatedRecords);

    // Insert attendance records
    const { data: attendanceData, error: attendanceError } =
      await supabase.supabase
        .from("ds_attendance")
        .insert(validatedRecords)
        .select();

    if (attendanceError) {
      console.error("Error creating attendance records:", attendanceError);

      // Cleanup: delete the session if attendance insertion failed
      await supabase.supabase
        .from("ds_class_sessions")
        .delete()
        .eq("session_id", sessionData.session_id);

      return res.status(500).json({
        success: false,
        error: "Failed to create attendance records",
        details: attendanceError.message,
      });
    }

    res.json({
      success: true,
      message: "Attendance created successfully",
      data: {
        session: sessionData,
        attendance_records: attendanceData,
        total_records: attendanceData.length,
      },
    });
  } catch (error) {
    console.error("Create attendance error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Update existing attendance session and records
 * PUT /updateAttendance/:sessionId
 */
app.put("/updateAttendance/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { topic, notes, recorded_by, attendance_records, course_id } =
      req.body;

    if (!sessionId) {
      return res
        .status(400)
        .json({ success: false, error: "Session ID is required" });
    }

    if (!Array.isArray(attendance_records)) {
      return res.status(400).json({
        success: false,
        error: "Attendance records array is required",
      });
    }

    // Update session info
    const { error: sessionError } = await supabase.supabase
      .from("ds_class_sessions")
      .update({
        topic: topic || null,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId);

    if (sessionError) {
      console.error("Error updating session:", sessionError);
      return res
        .status(500)
        .json({ success: false, error: "Failed to update session" });
    }

    // Validate and prepare attendance records
    const validatedRecords = attendance_records.map((record) => ({
      course_id,
      student_id: record.student_id,
      session_id: sessionId,
      present: record.present,
      good_behavior: record.good_behavior,
      notes: record.notes || null,
      recorded_by,
      recorded_at: new Date().toISOString(),
    }));
    console.log(validatedRecords);
    // Insert/update attendance
    // First, delete existing attendance for this session
    await supabase.supabase
      .from("ds_attendance")
      .delete()
      .eq("session_id", sessionId);

    // Then insert the new records
    const { data: attendanceData, error: attendanceError } =
      await supabase.supabase
        .from("ds_attendance")
        .insert(validatedRecords)
        .select();

    console.log("Attendance upsert result:", {
      attendanceData,
      attendanceError,
    });

    if (attendanceError) {
      return res.status(500).json({
        success: false,
        error: "Failed to update attendance records",
      });
    }

    res.json({
      success: true,
      message: "Attendance updated successfully",
      data: {
        attendance_records: attendanceData,
        total_records: attendanceData?.length || 0,
      },
    });
  } catch (error) {
    console.error("Update attendance error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * Get current user information
 * GET /getCurrentUser
 */
app.get("/getCurrentUser", async (req, res) => {
  try {
    // This depends on your authentication middleware
    // Adjust based on how you handle user authentication
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    const { data, error } = await supabase
      .from("users")
      .select("id, first_name, last_name, email")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error fetching current user:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch user information",
      });
    }

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Get attendance statistics for a course
 * GET /getAttendanceStats/:courseId
 */
app.get("/getAttendanceScores/:studentId/:courseId", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: "Course ID is required",
      });
    }

    let query = supabase.supabase
      .from("ds_attendance")
      .select(
        `
        status,
        ds_class_sessions!inner (
          course_id,
          session_date
        )
      `
      )
      .eq("ds_class_sessions.course_id", courseId);

    // Add date filters if provided
    if (startDate) {
      query = query.gte("ds_class_sessions.session_date", startDate);
    }
    if (endDate) {
      query = query.lte("ds_class_sessions.session_date", endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching attendance stats:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // Calculate statistics
    const stats = {
      total: data.length,
      present: data.filter((record) => record.status === "present").length,
      absent: data.filter((record) => record.status === "absent").length,
      late: data.filter((record) => record.status === "late").length,
      excused: data.filter((record) => record.status === "excused").length,
      attendance_rate: 0,
    };

    if (stats.total > 0) {
      stats.attendance_rate = Math.round(
        ((stats.present + stats.excused) / stats.total) * 100
      );
    }

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Get attendance stats error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Delete attendance session and all related records
 * DELETE /deleteAttendanceSession/:sessionId
 */
app.delete("/deleteAttendanceSession/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "Session ID is required",
      });
    }

    // Delete attendance records first (due to foreign key constraint)
    const { error: attendanceError } = await supabase.supabase
      .from("ds_attendance")
      .delete()
      .eq("session_id", sessionId);

    if (attendanceError) {
      console.error("Error deleting attendance records:", attendanceError);
      return res.status(500).json({
        success: false,
        error: "Failed to delete attendance records",
      });
    }

    // Delete the session
    const { error: sessionError } = await supabase.supabase
      .from("ds_class_sessions")
      .delete()
      .eq("session_id", sessionId);

    if (sessionError) {
      console.error("Error deleting session:", sessionError);
      return res.status(500).json({
        success: false,
        error: "Failed to delete session",
      });
    }

    res.json({
      success: true,
      message: "Attendance session deleted successfully",
    });
  } catch (error) {
    console.error("Delete attendance session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Student Enrollment endpoint
 */
app.post("/enrollStudent", async (req, res) => {
  try {
    const { student_id, course_id } = req.body;

    // Validate required fields
    if (!student_id || !course_id) {
      return res.status(400).json({
        error: "student_id and course_id are required",
      });
    }

    // Check if student is already enrolled in this course
    const { data: existing, error: checkError } = await supabase.supabase
      .from("ds_student_enrollment")
      .select("*")
      .eq("student_id", student_id)
      .eq("course_id", course_id);

    if (checkError) {
      console.error("Error checking existing enrollment:", checkError);
      return res.status(500).json({ error: checkError.message });
    }

    if (existing && existing.length > 0) {
      // Student already enrolled, update to active
      const { data, error } = await supabase.supabase
        .from("ds_student_enrollment")
        .update({
          course_id: course_id,
          is_active: true,
          enrolled_date: new Date().toISOString().split("T")[0],
        })
        .eq("student_id", student_id)
        .eq("course_id", course_id)
        .select();

      if (error) {
        console.error("Supabase update error:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        message: "Student enrollment updated successfully",
        data: data,
      });
    } else {
      // New enrollment
      const body = {
        student_id: student_id,
        course_id: course_id,
        enrolled_date: new Date().toISOString().split("T")[0],
        is_active: true,
      };

      console.log("Inserting student enrollment:", body);

      const { data, error } = await supabase.supabase
        .from("ds_student_enrollment")
        .insert([body])
        .select();

      if (error) {
        console.error("Supabase insert error:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        message: "Student enrolled successfully",
        data: data,
      });
    }
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/unenrollStudent", async (req, res) => {
  try {
    const { student_id, course_id } = req.body;

    // Validate input
    if (!student_id || !course_id) {
      return res.status(400).json({
        error: "Both student_id and course_id are required",
      });
    }

    // Check enrollment
    const { data: existing, error: checkError } = await supabase
      .from("ds_student_enrollment")
      .select("id")
      .eq("student_id", student_id)
      .eq("course_id", course_id)
      .maybeSingle(); // returns null if none found

    if (checkError) {
      console.error("Error checking enrollment:", checkError);
      return res.status(500).json({ error: checkError.message });
    }

    if (!existing) {
      return res.status(404).json({
        error: "Student is not enrolled in this course",
      });
    }

    // Mark enrollment inactive
    const { data, error } = await supabase
      .from("ds_student_enrollment")
      .update({
        is_active: false,
        unenrolled_date: new Date().toISOString().split("T")[0],
      })
      .eq("student_id", student_id)
      .eq("course_id", course_id)
      .select();

    if (error) {
      console.error("Supabase unenrollStudent error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      message: "Student unenrolled successfully",
      data,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/getEnrolledDSStudents/:course_id", async (req, res) => {
  // Check if student is already enrolled in this course
  const { course_id } = req.params;
  const { data: data, error: error } = await supabase.supabase
    .from("ds_student_enrollment")
    .select("*")
    .eq("course_id", course_id);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

app.put("/updateAllLevels", async (req, res) => {
  const levelMap = {
    1: "ds_level_alpha",
    2: "ds_level_beta",
    3: "ds_level_1",
    4: "ds_level_2",
    5: "ds_level_3",
    6: "ds_level_4",
    7: "ds_level_5",
    8: "ds_level_6",
    9: "ds_level_7",
    10: "ds_level_8",
    11: "ds_level_9",
    12: "ds_level_10",
    13: "ds_level_graduates",
    14: "ds_level_graduates",
  };

  try {
    for (let index = 1; index <= 14; index++) {
      console.log(`Updating index ${index} to ${levelMap[index]}`);

      const { data, error } = await supabase.supabase
        .from("deacons_school_altar_responses")
        .update({ level: levelMap[index] })
        .eq("level", index.toString()) // match the original value
        .select();

      if (error) {
        console.error(`Error updating index ${index}:`, error);
      } else {
        console.log(`Updated ${data.length} rows for index ${index}`);
      }
    }

    res.status(200).send("DONE");
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).send("Server error");
  }
});

app.get("/getCalendarByCourse/:course_id", async (req, res) => {
  const course_id = req.params.course_id;
  console.log(course_id);
  let { data, error } = await supabase.supabase
    .from("ds_calendar_week")
    .select("*")
    .contains("courses_id", [course_id]); // course_id must be inside an array
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getCalendarByCurrentWeekAndCourse/:course_id", async (req, res) => {
  const { course_id } = req.params;
  try {
    const { data, error } = await supabase.supabase.rpc(
      "get_current_week_calendar_by_course",
      {
        p_course_id: course_id,
      }
    );
    const uniqueData = Array.from(
      new Map(data.map((item) => [item.content_id, item])).values()
    );

    console.log(uniqueData);
    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        error: "Database query failed",
        details: error.message,
      });
    }

    res.send(uniqueData);
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

// Get all grading categories
app.get("/getGradingCategories", async (req, res) => {
  try {
    const { data, error } = await supabase.supabase
      .from("ds_grading_categories")
      .select("*")
      .eq("is_active", true)
      .order("category_name");

    if (error) {
      console.error("Error fetching grading categories:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get quarters/terms
app.get("/getQuarters", async (req, res) => {
  try {
    const { data, error } = await supabase.supabase
      .from("ds_quarters")
      .select("*")
      .eq("is_active", true)
      .order("start_date", { ascending: false });

    if (error) {
      console.error("Error fetching quarters:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get assessment items by category
app.get("/getAssessmentItems/:categoryId/:course_id", async (req, res) => {
  try {
    const { categoryId, course_id } = req.params;

    const { data, error } = await supabase.supabase
      .from("ds_assessment_items")
      .select(
        `
        *,
        ds_grading_categories:category_id (
          category_name,
          weight_percentage
        )
      `
      )
      .eq("category_id", categoryId)
      .eq("course_id", course_id)
      .eq("is_active", true)
      .order("item_name");

    if (error) {
      console.error("Error fetching assessment items:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
// Get assessment items by category
app.get("/getAssessmentItemsByCourse/:course_id", async (req, res) => {
  try {
    const { course_id } = req.params;

    const { data, error } = await supabase.supabase
      .from("ds_assessment_items")
      .select(
        `
        *,
        ds_grading_categories:category_id (
          category_name,
          weight_percentage
        )
      `
      )
      .eq("course_id", course_id)
      .eq("is_active", true)
      .order("item_name");

    if (error) {
      console.error("Error fetching assessment items:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get available hymns/rituals/etc for assessment creation
app.get("/getAvailableItems/:category", async (req, res) => {
  try {
    const { category } = req.params;
    let tableName;
    let selectFields = "id, *";

    switch (category) {
      case "hymns":
        tableName = "deacons_school_hymns";
        selectFields = "id, name, points, level_hymn_in";
        break;
      case "rituals":
        tableName = "deacons_school_rituals";
        selectFields = "id, name, level";
        break;
      case "memorization":
        tableName = "deacons_school_memorization";
        selectFields = "id, name, level";
        break;
      case "altar_responses":
        tableName = "deacons_school_altar_responses";
        selectFields = "id, name, level";
        break;
      default:
        return res
          .status(400)
          .json({ success: false, error: "Invalid category" });
    }

    const { data, error } = await supabase.supabase
      .from(tableName)
      .select(selectFields)
      .order("name");

    if (error) {
      console.error(`Error fetching ${category}:`, error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Create assessment item
app.post("/createAssessmentItem", async (req, res) => {
  try {
    const {
      category_id,
      course_id,
      max_points,
      item_name,
      item_reference,
      reference_id,
    } = req.body;
    console.log(course_id);
    console.log(item_name);
    console.log(course_id);
    if (!category_id || !item_name || !course_id) {
      return res.status(400).json({
        success: false,
        error: "Category ID and item name are required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_assessment_items")
      .insert([
        {
          category_id,
          course_id,
          max_points,
          item_name,
          item_reference: item_reference || null,
          reference_id: reference_id || null,
          is_active: true,
        },
      ])
      .select();

    if (error) {
      console.error("Error creating assessment item:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data: data[0] });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get student scores
app.get("/getStudentScores/:studentId/:courseId", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    const { data, error } = await supabase.supabase.rpc(
      "get_student_all_scores",
      {
        p_student_id: studentId,
        p_course_id: courseId,
      }
    );
    console.log(data);
    if (error) {
      console.error("Error fetching scores:", error);
    } else {
      console.log("All Scores (including attendance & behavior):", data);
    }

    if (error) {
      console.error("Error fetching student scores:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Submit student score
app.post("/submitStudentScore", async (req, res) => {
  try {
    const {
      student_id,
      course_id,
      quarter_id,
      item_id,
      points_earned,
      scored_by,
      notes,
    } = req.body;

    // Validation
    if (
      !student_id ||
      !course_id ||
      !quarter_id ||
      !item_id ||
      points_earned === undefined
    ) {
      return res.status(400).json({
        success: false,
        error: "All required fields must be provided",
      });
    }

    // Get points possible (will be set by trigger, but we can calculate for response)
    const { data: itemData } = await supabase.supabase
      .from("ds_assessment_items")
      .select("item_reference, reference_id")
      .eq("item_id", item_id)
      .single();

    let points_possible = 100; // default
    if (
      itemData?.item_reference === "deacons_school_hymns" &&
      itemData?.reference_id
    ) {
      const { data: hymnData } = await supabase.supabase
        .from("deacons_school_hymns")
        .select("points")
        .eq("id", itemData.reference_id)
        .single();
      points_possible = hymnData?.points || 100;
    }

    const { data, error } = await supabase.supabase
      .from("ds_student_scores")
      .upsert(
        [
          {
            student_id,
            course_id,
            quarter_id,
            item_id,
            points_earned: parseFloat(points_earned),
            points_possible,
            scored_by,
            notes: notes || null,
            scored_date: new Date().toISOString().split("T")[0],
          },
        ],
        {
          onConflict: "student_id,course_id,quarter_id,item_id",
        }
      )
      .select();

    if (error) {
      console.error("Error submitting student score:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: "Score submitted successfully",
      data: data[0],
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Submit multiple scores (batch)
app.post("/submitBatchScores", async (req, res) => {
  try {
    const { scores, scored_by } = req.body;

    if (!Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Scores array is required",
      });
    }

    // Prepare scores with scored_by and date
    const processedScores = scores.map((score) => ({
      ...score,
      points_earned: parseFloat(score.points_earned),
      scored_by,
      scored_date: new Date().toISOString().split("T")[0],
    }));

    const { data, error } = await supabase.supabase
      .from("ds_student_scores")
      .upsert(processedScores, {
        onConflict: "student_id, course_id, item_id",
      })
      .select();

    if (error) {
      console.error("Error submitting batch scores:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: `${data.length} scores submitted successfully`,
      data,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get student final grades
app.get("/getStudentGrades/:studentId/:courseId/", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    const { data, error } = await supabase.supabase
      .from("ds_student_final_grades")
      .select("*")
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found
      console.error("Error fetching student grades:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data: data || null });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get yearly progress for student
app.get(
  "/getYearlyProgress/:studentId/:courseId/:academicYear",
  async (req, res) => {
    try {
      const { studentId, courseId, academicYear } = req.params;

      // Get yearly requirement
      const { data: requirement } = await supabase.supabase
        .from("ds_yearly_requirements")
        .select("total_points_to_pass")
        .eq("course_id", courseId)
        .eq("academic_year", academicYear)
        .single();

      // Get student's yearly totals
      const { data: yearlyGrades } = await supabase.supabase
        .from("ds_student_final_grades")
        .select("total_raw_points, yearly_total_points, is_passing_year")
        .eq("student_id", studentId)
        .eq("course_id", courseId)
        .eq("academic_year", academicYear);

      let totalPoints = 0;
      let isPassingYear = false;

      if (yearlyGrades && yearlyGrades.length > 0) {
        totalPoints = yearlyGrades.reduce(
          (sum, grade) => sum + (grade.total_raw_points || 0),
          0
        );
        isPassingYear = yearlyGrades.some((grade) => grade.is_passing_year);
      }

      res.json({
        success: true,
        data: {
          academic_year: academicYear,
          total_points_earned: totalPoints,
          points_required: requirement?.total_points_to_pass || 0,
          is_passing: isPassingYear,
          quarters: yearlyGrades || [],
        },
      });
    } catch (err) {
      console.error("Unexpected error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
);

// Get class average for assignment
app.get("/getClassAverage/:courseId/:quarterId/:itemId", async (req, res) => {
  try {
    const { courseId, quarterId, itemId } = req.params;

    const { data, error } = await supabase.supabase
      .from("ds_student_scores")
      .select("points_earned, points_possible")
      .eq("course_id", courseId)
      .eq("quarter_id", quarterId)
      .eq("item_id", itemId);

    if (error) {
      console.error("Error fetching class average:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    if (!data || data.length === 0) {
      return res.json({
        success: true,
        data: {
          average_percentage: 0,
          total_students: 0,
          scores_entered: 0,
        },
      });
    }

    const scores = data.map(
      (score) => (score.points_earned / score.points_possible) * 100
    );
    const average =
      scores.reduce((sum, score) => sum + score, 0) / scores.length;

    res.json({
      success: true,
      data: {
        average_percentage: Math.round(average * 100) / 100,
        total_students: data.length,
        scores_entered: data.filter((score) => score.points_earned > 0).length,
      },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Recalculate student grade manually
app.post("/recalculateGrade", async (req, res) => {
  try {
    const { student_id, course_id, quarter_id } = req.body;

    if (!student_id || !course_id || !quarter_id) {
      return res.status(400).json({
        success: false,
        error: "Student ID, course ID, and quarter ID are required",
      });
    }

    // Call the calculation function
    const { error } = await supabase.supabase.rpc("calculate_student_grade", {
      p_student_id: student_id,
      p_course_id: course_id,
      p_quarter_id: quarter_id,
    });

    if (error) {
      console.error("Error recalculating grade:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: "Grade recalculated successfully",
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Delete assessment item
app.delete("/deleteAssessmentItem/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: "Item ID is required",
      });
    }

    // Check if there are any scores for this item
    const { data: existingScores } = await supabase.supabase
      .from("ds_student_scores")
      .select("score_id")
      .eq("item_id", itemId)
      .limit(1);

    if (existingScores && existingScores.length > 0) {
      return res.status(400).json({
        success: false,
        error:
          "Cannot delete assessment item that has student scores. Please deactivate instead.",
      });
    }

    const { error } = await supabase.supabase
      .from("ds_assessment_items")
      .delete()
      .eq("item_id", itemId);

    if (error) {
      console.error("Error deleting assessment item:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: "Assessment item deleted successfully",
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Update assessment item
app.put("/updateAssessmentItem/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const updates = req.body;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: "Item ID is required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_assessment_items")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("item_id", itemId)
      .select()
      .single();

    if (error) {
      console.error("Error updating assessment item:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: "Assessment item updated successfully",
      data,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

module.exports = app;
