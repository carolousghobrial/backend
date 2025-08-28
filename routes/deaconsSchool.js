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
app.get("/getdeaconsschoolextrasbylevel/:level", async (req, res) => {
  //get_deacons_school_extras_by_level
  const level = req.params.level;
  const { data, error } = await supabase.supabase.rpc(
    "get_deacons_school_extras_by_level",
    {
      level_param: level,
    }
  );
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
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

    if (error && error.code !== "PGRST116") {
      console.error("Error fetching class session:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
    console.log(data);
    if (!data) {
      body = { course_id: courseId, session_date: date };
      console.log(body);
      const { adddata, adderror } = await supabase.supabase
        .from("ds_class_sessions")
        .insert([body])
        .select();
      if (adderror) {
        console.error("Error fetching class session:", adderror);
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }
      console.log(adddata);
      res.send(adddata);
    } else {
      res.json(data);
    }
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
    session_body = {};
    //create session instance
    const { data, error } = await supabase.supabase
      .from("ds_class_sessions")
      .insert([]);
    // Get current user ID (you'll need to implement this based on your auth system)

    // Validate and prepare attendance records
    const validatedRecords = [];
    for (const record of attendance_records) {
      if (!record.student_id || !record.status) {
        return res.status(400).json({
          success: false,
          error: "Each attendance record must have student_id and status",
        });
      }

      validatedRecords.push({
        student_id: record.student_id,
        session_id: session.session_id,
        status: record.status,
        arrival_time: record.arrival_time || null,
        notes: record.notes || null,
        recorded_by: recorded_by,
        recorded_at: new Date().toISOString(),
      });
    }

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
        .eq("session_id", session.session_id);

      return res.status(500).json({
        success: false,
        error: "Failed to create attendance records",
      });
    }

    res.json({
      success: true,
      message: "Attendance created successfully",
      data: {
        session: session,
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
    const { topic, notes, recorded_by, attendance_records } = req.body;
    console.log(sessionId);
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "Session ID is required",
      });
    }

    if (!Array.isArray(attendance_records)) {
      return res.status(400).json({
        success: false,
        error: "Attendance records array is required",
      });
    }

    // Update session information
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
      return res.status(500).json({
        success: false,
        error: "Failed to update session",
      });
    }

    // Delete existing attendance records for this session
    const { error: deleteError } = await supabase.supabase
      .from("ds_attendance")
      .delete()
      .eq("session_id", sessionId);

    if (deleteError) {
      console.error("Error deleting old attendance records:", deleteError);
      return res.status(500).json({
        success: false,
        error: "Failed to update attendance records",
      });
    }

    // Validate and insert new attendance records
    const validatedRecords = [];
    for (const record of attendance_records) {
      body = {
        student_id: record.student_id,
        session_id: sessionId,
        present: record.present,
        notes: record.notes || null,
        recorded_by: recorded_by,
        recorded_at: new Date().toISOString(),
      };
      console.log(body);
      validatedRecords.push(body);
    }

    // Insert updated attendance records
    const { data: attendanceData, error: attendanceError } =
      await supabase.supabase
        .from("ds_attendance")
        .insert(validatedRecords)
        .select();
    console.log(attendanceError);
    if (attendanceError) {
      console.error(
        "Error inserting updated attendance records:",
        attendanceError
      );
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
        total_records: attendanceData.length,
      },
    });
  } catch (error) {
    console.error("Update attendance error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
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
app.get("/getAttendanceStats/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;
    const { startDate, endDate } = req.query;

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

app.get("/getCalendarByLevel/:level", async (req, res) => {
  const level = req.params.level;
  let { data: data, error } = await supabase.supabase
    .from("ds_calendar_week")
    .select("*")
    .eq("level", level);

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

module.exports = app;
