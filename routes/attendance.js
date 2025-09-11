const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const supabase = require("../config/config");

// Parse application/json
app.use(bodyParser.json());

// Parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware to extract and verify JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token is required",
    });
  }

  try {
    // Verify the JWT token with Supabase
    const {
      data: { user },
      error,
    } = await supabase.supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(403).json({
      success: false,
      message: "Token verification failed",
    });
  }
};

// Optional auth middleware - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    try {
      const {
        data: { user },
        error,
      } = await supabase.supabase.auth.getUser(token);
      if (!error && user) {
        req.user = user;
        req.token = token;
      }
    } catch (error) {
      console.error("Optional auth error:", error);
    }
  }
  next();
};

// ==================== ATTENDANCE ROUTES ====================

/**
 * Health check endpoint
 */
app.get("/", async (req, res) => {
  res.json({
    success: true,
    message: "Attendance API is running",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Log individual attendance record
 */
app.post("/logattendance", authenticateToken, async (req, res) => {
  try {
    const {
      portal_id,
      date,
      timestamp,
      service_id,
      name,
      created_at,
      taken_by,
    } = req.body;
    console.log(req.body);
    console.log(portal_id);

    // Validate required fields
    if (!portal_id || !date || !timestamp || !service_id) {
      return res.status(400).json({
        success: false,
        message: "portal_id, date, timestamp, and service_id are required",
      });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        message: "Date must be in YYYY-MM-DD format",
      });
    }

    // Validate timestamp format but don't convert it
    const timestampDate = new Date(timestamp);
    if (isNaN(timestampDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid timestamp format",
      });
    }

    console.log("Logging attendance for:", portal_id, date, service_id);
    console.log("Original timestamp:", timestamp);
    console.log("Parsed timestamp:", timestampDate);

    // Check if attendance already exists for this person/date/service
    const { data: existingAttendance, error: checkError } =
      await supabase.supabase
        .from("attendance")
        .select("id")
        .eq("portal_id", portal_id)
        .eq("date", date)
        .eq("service_id", service_id)
        .single();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("Error checking existing attendance:", checkError);
      return res.status(500).json({
        success: false,
        message: "Error checking existing attendance",
      });
    }

    if (existingAttendance) {
      return res.status(409).json({
        success: false,
        message: "Attendance already recorded for this person today",
        data: existingAttendance,
      });
    }

    // Insert new attendance record - use original timestamp
    const attendanceData = {
      portal_id: portal_id,
      date: date,
      taken_by: taken_by,
      timestamp: timestamp, // Keep original timestamp string
      service_id: service_id,
      created_at: created_at || new Date().toISOString(), // Use provided created_at or current time
    };

    console.log("Inserting attendance data:", attendanceData);

    const { data, error } = await supabase.supabase
      .from("attendance")
      .insert([attendanceData])
      .select()
      .single();

    if (error) {
      console.error("Error logging attendance:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    console.log("Successfully inserted attendance:", data);

    res.status(201).json({
      success: true,
      message: "Attendance logged successfully",
      data: data,
    });
  } catch (error) {
    console.error("Log attendance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to log attendance",
    });
  }
});
/**
 * Submit final attendance report for the day
 */
app.post("/submitattendancereport", authenticateToken, async (req, res) => {
  try {
    const { date, totalAttendees, attendees, submittedAt } = req.body;

    if (!date || !totalAttendees || !attendees || !Array.isArray(attendees)) {
      return res.status(400).json({
        success: false,
        message: "date, totalAttendees, and attendees array are required",
      });
    }

    // Get submitter's portal_id
    const { data: profile, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("portal_id")
      .eq("id", req.user.id)
      .single();

    const submittedBy = profile?.portal_id || null;

    // Insert attendance report
    const reportData = {
      date: date,
      total_attendees: totalAttendees,
      submitted_by: submittedBy,
      submitted_at: submittedAt
        ? new Date(submittedAt).toISOString()
        : new Date().toISOString(),
      notes: `Report submitted with ${attendees.length} attendees`,
    };

    const { data, error } = await supabase.supabase
      .from("attendance_reports")
      .insert([reportData])
      .select()
      .single();

    if (error) {
      console.error("Error submitting attendance report:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.status(201).json({
      success: true,
      message: "Attendance report submitted successfully",
      data: data,
    });
  } catch (error) {
    console.error("Submit attendance report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit attendance report",
    });
  }
});

/**
 * Get attendance records for a specific date
 */
/**
 * Get attendance records for a specific date using PostgreSQL function
 */
app.get("/getAttendanceByDate/:date", authenticateToken, async (req, res) => {
  try {
    const { date } = req.params;

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        message: "Date must be in YYYY-MM-DD format",
      });
    }

    console.log("Getting attendance for date:", date);

    // Use the PostgreSQL function instead of direct query
    const { data, error } = await supabase.supabase.rpc(
      "get_attendance_by_date",
      {
        p_date: date,
      }
    );

    if (error) {
      console.error("Error getting attendance:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    console.log("Attendance data with profiles:", data);

    res.send(data);
  } catch (error) {
    console.error("Get attendance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get attendance records",
    });
  }
});

/**
 * Get attendance records for a date range
 */
app.get("/getattendanceByDateRange", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required",
      });
    }

    // Validate date formats
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        message: "Dates must be in YYYY-MM-DD format",
      });
    }

    console.log("Getting attendance for date range:", startDate, "to", endDate);

    const { data, error } = await supabase.supabase
      .from("attendance")
      .select("*")
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: false })
      .order("timestamp", { ascending: false });

    if (error) {
      console.error("Error getting attendance by date range:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.json({
      success: true,
      data: data || [],
      count: data ? data.length : 0,
      dateRange: { startDate, endDate },
    });
  } catch (error) {
    console.error("Get attendance by date range error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get attendance records",
    });
  }
});

/**
 * Get attendance statistics
 */
app.get("/attendance/stats", authenticateToken, async (req, res) => {
  try {
    const { period = "month" } = req.query;
    const validPeriods = ["week", "month", "year"];

    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Period must be one of: week, month, year",
      });
    }

    let dateFilter;
    const now = new Date();

    switch (period) {
      case "week":
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "year":
        dateFilter = new Date(now.getFullYear(), 0, 1);
        break;
    }

    const filterDate = dateFilter.toISOString().split("T")[0];

    // Get total attendance count
    const { data: attendanceData, error: attendanceError } =
      await supabase.supabase
        .from("attendance")
        .select("portal_id, date, service_id")
        .gte("date", filterDate);

    if (attendanceError) {
      console.error("Error getting attendance stats:", attendanceError);
      return res.status(500).json({
        success: false,
        message: attendanceError.message,
      });
    }

    // Calculate statistics
    const totalAttendance = attendanceData.length;
    const uniqueAttendees = new Set(
      attendanceData.map((record) => record.portal_id)
    ).size;
    const service_idCounts = {};
    const dailyCounts = {};

    attendanceData.forEach((record) => {
      // Count by service type
      service_idCounts[record.service_id] =
        (service_idCounts[record.service_id] || 0) + 1;

      // Count by date
      dailyCounts[record.date] = (dailyCounts[record.date] || 0) + 1;
    });

    const averageDaily =
      totalAttendance > 0
        ? totalAttendance / Object.keys(dailyCounts).length
        : 0;

    res.json({
      success: true,
      data: {
        period: period,
        dateRange: {
          from: filterDate,
          to: now.toISOString().split("T")[0],
        },
        statistics: {
          totalAttendance: totalAttendance,
          uniqueAttendees: uniqueAttendees,
          averageDaily: Math.round(averageDaily * 100) / 100,
          service_idCounts: service_idCounts,
          dailyCounts: dailyCounts,
        },
      },
    });
  } catch (error) {
    console.error("Get attendance stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get attendance statistics",
    });
  }
});

/**
 * Check if a person already has attendance for a specific date
 */
app.get(
  "/attendance/check/:portal_id/:date",
  authenticateToken,
  async (req, res) => {
    try {
      const { portal_id, date } = req.params;
      const { service_id = "church_service" } = req.query;

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({
          success: false,
          message: "Date must be in YYYY-MM-DD format",
        });
      }

      const { data, error } = await supabase.supabase
        .from("attendance")
        .select("id")
        .eq("portal_id", portal_id)
        .eq("date", date)
        .eq("service_id", service_id)
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("Error checking attendance:", error);
        return res.status(500).json({
          success: false,
          message: error.message,
        });
      }

      const hasAttendance = !!data;

      res.json({
        success: true,
        hasAttendance: hasAttendance,
        data: data || null,
      });
    } catch (error) {
      console.error("Check attendance error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to check attendance",
      });
    }
  }
);

/**
 * Update attendance record
 */
app.patch("/attendance/:attendanceId", authenticateToken, async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated
    const allowedFields = ["timestamp", "service_id", "name"];
    const filteredUpdateData = {};

    allowedFields.forEach((field) => {
      if (updateData[field] !== undefined) {
        filteredUpdateData[field] = updateData[field];
      }
    });

    if (Object.keys(filteredUpdateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    // Validate timestamp if provided
    if (filteredUpdateData.timestamp) {
      const timestampDate = new Date(filteredUpdateData.timestamp);
      if (isNaN(timestampDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid timestamp format",
        });
      }
      filteredUpdateData.timestamp = timestampDate.toISOString();
    }

    const { data, error } = await supabase.supabase
      .from("attendance")
      .update(filteredUpdateData)
      .eq("id", attendanceId)
      .select()
      .single();

    if (error) {
      console.error("Error updating attendance:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    res.json({
      success: true,
      message: "Attendance updated successfully",
      data: data,
    });
  } catch (error) {
    console.error("Update attendance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update attendance",
    });
  }
});

/**
 * Delete attendance record
 */
app.delete("/attendance/:attendanceId", authenticateToken, async (req, res) => {
  try {
    const { attendanceId } = req.params;

    const { data, error } = await supabase.supabase
      .from("attendance")
      .delete()
      .eq("id", attendanceId)
      .select()
      .single();

    if (error) {
      console.error("Error deleting attendance:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    res.json({
      success: true,
      message: "Attendance deleted successfully",
      data: data,
    });
  } catch (error) {
    console.error("Delete attendance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete attendance",
    });
  }
});

/**
 * Export attendance data to CSV
 */
app.get("/attendance/export", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, service_id } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required",
      });
    }

    // Build query
    let query = supabase.supabase
      .from("attendance")
      .select("portal_id, name, date, timestamp, service_id")
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true })
      .order("timestamp", { ascending: true });

    if (service_id) {
      query = query.eq("service_id", service_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error exporting attendance:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    // Convert to CSV
    const headers = ["Portal ID", "Name", "Date", "Time", "Service Type"];
    const csvRows = [headers.join(",")];

    data.forEach((record) => {
      const row = [
        record.portal_id,
        `"${record.name || ""}"`,
        record.date,
        new Date(record.timestamp).toLocaleTimeString(),
        record.service_id,
      ];
      csvRows.push(row.join(","));
    });

    const csvContent = csvRows.join("\n");

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="attendance_${startDate}_to_${endDate}.csv"`
    );

    res.send(csvContent);
  } catch (error) {
    console.error("Export attendance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export attendance data",
    });
  }
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Global error handler:", error);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    ...(process.env.NODE_ENV === "development" && { error: error.message }),
  });
});

module.exports = app;
