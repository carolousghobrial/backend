const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const moment = require("moment");

app.use(bp.json());

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function generateConfirmationId() {
  return (
    "CONF-" +
    Date.now().toString().slice(-6) +
    Math.random().toString(36).substr(2, 3).toUpperCase()
  );
}

function generateAvailableSlots(
  startDate,
  endDate,
  targetDays,
  startTime,
  endTime,
  slotDuration
) {
  const availableSlots = [];

  for (
    let date = moment(startDate);
    date.isSameOrBefore(endDate);
    date.add(1, "day")
  ) {
    if (targetDays.includes(date.day())) {
      const currentDate = date.format("YYYY-MM-DD");
      const slots = generateTimeSlots(
        currentDate,
        startTime,
        endTime,
        slotDuration
      );
      availableSlots.push(...slots);
    }
  }

  return availableSlots;
}

function generateTimeSlots(date, startTime, endTime, slotDuration) {
  const slots = [];
  let currentTime = moment(date + " " + startTime, "YYYY-MM-DD HH:mm");
  const endTimeMoment = moment(date + " " + endTime, "YYYY-MM-DD HH:mm");

  while (currentTime.isBefore(endTimeMoment)) {
    const slotEndTime = moment(currentTime).add(slotDuration, "minutes");

    slots.push({
      slot_date: currentTime.format("YYYY-MM-DD"),
      start_time: currentTime.format("HH:mm:ss"),
      end_time: slotEndTime.format("HH:mm:ss"),
      duration_minutes: slotDuration,
      status: "available",
      max_capacity: 1,
      current_bookings: 0,
      location: "Main Church",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    currentTime.add(slotDuration, "minutes");
  }

  return slots;
}

// =====================================================
// AVAILABILITY SLOTS ENDPOINTS
// =====================================================

// Create availability slots for a date range
app.post("/api/availability/generate", async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      targetDays = [0, 6], // Default: Sunday and Saturday
      startTime = "09:00",
      endTime = "17:00",
      slotDuration = 15,
      priestName = "Father Thomas Anderson",
    } = req.body;

    const availableSlots = generateAvailableSlots(
      startDate,
      endDate,
      targetDays,
      startTime,
      endTime,
      slotDuration
    );

    // Add priest name to all slots
    availableSlots.forEach((slot) => {
      slot.priest_name = priestName;
    });

    const { data, error } = await supabase.supabase
      .from("confession_availability_slots")
      .insert(availableSlots)
      .select();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: `Created ${data.length} availability slots`,
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Create single availability slot
app.post("/api/availability/single", async (req, res) => {
  try {
    const {
      slot_date,
      start_time,
      end_time,
      duration_minutes = 15,
      location = "Main Church",
    } = req.body;

    const slotData = {
      slot_date,
      start_time,
      end_time,
      duration_minutes,
      status: "available",
      max_capacity: 1,
      current_bookings: 0,
      location,
    };

    const { data, error } = await supabase.supabase
      .from("confession_availability_slots")
      .insert([slotData])
      .select();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Availability slot created successfully",
      data: data[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get available slots for a date range
app.get("/api/availability/range", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = supabase.supabase
      .from("confession_availability_slots")
      .select("*")
      .in("status", ["available", "booked"])
      .order("slot_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (startDate) {
      query = query.gte("slot_date", startDate);
    }
    if (endDate) {
      query = query.lte("slot_date", endDate);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get available slots only
app.get("/api/availability/available", async (req, res) => {
  try {
    const { date } = req.query;

    let query = supabase.supabase
      .from("confession_availability_slots")
      .select("*")
      .eq("status", "available")
      .order("slot_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (date) {
      query = query.eq("slot_date", date);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Block/unblock availability slot
app.patch("/api/availability/:slotId/block", async (req, res) => {
  try {
    const { slotId } = req.params;
    const { block = true, reason } = req.body;

    const newStatus = block ? "blocked" : "available";
    const updateData = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (reason && block) {
      updateData.special_instructions = reason;
    }

    const { data, error } = await supabase.supabase
      .from("confession_availability_slots")
      .update(updateData)
      .eq("id", slotId)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      message: `Slot ${block ? "blocked" : "unblocked"} successfully`,
      data: data[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Delete availability slot
app.delete("/api/availability/:slotId", async (req, res) => {
  try {
    const { slotId } = req.params;

    // Check if slot has bookings
    const { data: bookings } = await supabase.supabase
      .from("confessions")
      .select("id")
      .eq("availability_slot_id", slotId)
      .in("status", ["scheduled", "confirmed"]);

    if (bookings && bookings.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete slot with existing bookings",
      });
    }

    const { error } = await supabase.supabase
      .from("confession_availability_slots")
      .delete()
      .eq("id", slotId);

    if (error) throw error;

    res.json({
      success: true,
      message: "Availability slot deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =====================================================
// CONFESSIONS ENDPOINTS
// =====================================================

// Schedule a new confession
app.post("/api/confessions/schedule", async (req, res) => {
  try {
    const {
      user_id,
      availability_slot_id,
      special_requests,
      notes,
      language_preference = "English",
      is_first_confession = false,
    } = req.body;

    // Check if slot is available
    const { data: slot, error: slotError } = await supabase.supabase
      .from("confession_availability_slots")
      .select("*")
      .eq("id", availability_slot_id)
      .eq("status", "available")
      .single();

    if (slotError || !slot) {
      return res.status(400).json({
        success: false,
        message: "Selected time slot is not available",
      });
    }

    // Get user information
    const { data: user, error: userError } = await supabase.supabase
      .from("users")
      .select("first_name, last_name, email")
      .eq("id", user_id)
      .single();

    if (userError || !user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    // Create confession record
    const confessionData = {
      user_id,
      availability_slot_id,
      confession_date: slot.slot_date,
      confession_time: slot.start_time,
      duration_minutes: slot.duration_minutes,
      confirmation_id: generateConfirmationId(),
      status: "scheduled",
      special_requests,
      notes,
      language_preference,
      is_first_confession,
      user_name: `${user.first_name} ${user.last_name}`,
      user_email: user.email,
    };

    const { data: confession, error: confessionError } = await supabase.supabase
      .from("confessions")
      .insert([confessionData])
      .select();

    if (confessionError) throw confessionError;

    // Update availability slot
    const { error: updateError } = await supabase.supabase
      .from("confession_availability_slots")
      .update({
        status: "booked",
        current_bookings: slot.current_bookings + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", availability_slot_id);

    if (updateError) throw updateError;

    res.status(201).json({
      success: true,
      message: "Confession scheduled successfully",
      data: confession[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get confessions for a date range
app.get("/api/confessions", async (req, res) => {
  try {
    const { startDate, endDate, status, userId, priestId } = req.query;

    let query = supabase.supabase
      .from("confessions")
      .select(
        `
        *,
        users:user_id (first_name, last_name, email, cellphone),
        confession_availability_slots:availability_slot_id (slot_date, start_time, end_time, location)
      `
      )
      .order("confession_date", { ascending: true })
      .order("confession_time", { ascending: true });

    if (startDate) query = query.gte("confession_date", startDate);
    if (endDate) query = query.lte("confession_date", endDate);
    if (status) query = query.eq("status", status);
    if (userId) query = query.eq("user_id", userId);
    if (priestId) query = query.eq("priest_id", priestId);

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get confession by ID
app.get("/api/confessions/:confessionId", async (req, res) => {
  try {
    const { confessionId } = req.params;

    const { data, error } = await supabase.supabase
      .from("confessions")
      .select(
        `
        *,
        users:user_id (first_name, last_name, email, cellphone, dob),
        confession_availability_slots:availability_slot_id (slot_date, start_time, end_time, location)
      `
      )
      .eq("id", confessionId)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Confirm confession
app.patch("/api/confessions/:confessionId/confirm", async (req, res) => {
  try {
    const { confessionId } = req.params;

    const { data, error } = await supabase.supabase
      .from("confessions")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", confessionId)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      message: "Confession confirmed successfully",
      data: data[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Cancel confession
app.patch("/api/confessions/:confessionId/cancel", async (req, res) => {
  try {
    const { confessionId } = req.params;
    const { cancellation_reason } = req.body;

    // Get confession details
    const { data: confession, error: confessionError } = await supabase.supabase
      .from("confessions")
      .select("availability_slot_id, status")
      .eq("id", confessionId)
      .single();

    if (confessionError || !confession) {
      return res.status(404).json({
        success: false,
        message: "Confession not found",
      });
    }

    // Update confession status
    const { data, error } = await supabase.supabase
      .from("confessions")
      .update({
        status: "cancelled",
        cancellation_reason,
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", confessionId)
      .select();

    if (error) throw error;

    // Make slot available again
    const { error: slotError } = await supabase.supabase
      .from("confession_availability_slots")
      .update({
        status: "available",
        current_bookings: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", confession.availability_slot_id);

    if (slotError) throw slotError;

    res.json({
      success: true,
      message: "Confession cancelled successfully",
      data: data[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Complete confession
app.patch("/api/confessions/:confessionId/complete", async (req, res) => {
  try {
    const { confessionId } = req.params;
    const { notes, duration_minutes } = req.body;

    const updateData = {
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (notes) updateData.notes = notes;
    if (duration_minutes) updateData.duration_minutes = duration_minutes;

    const { data, error } = await supabase.supabase
      .from("confessions")
      .update(updateData)
      .eq("id", confessionId)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      message: "Confession marked as completed",
      data: data[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Update confession details
app.patch("/api/confessions/:confessionId", async (req, res) => {
  try {
    const { confessionId } = req.params;
    const updateData = {
      ...req.body,
      updated_at: new Date().toISOString(),
    };

    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData.user_id;
    delete updateData.availability_slot_id;
    delete updateData.confirmation_id;
    delete updateData.created_at;

    const { data, error } = await supabase.supabase
      .from("confessions")
      .update(updateData)
      .eq("id", confessionId)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      message: "Confession updated successfully",
      data: data[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =====================================================
// STATISTICS AND REPORTING ENDPOINTS
// =====================================================

// Get confession statistics
app.get("/api/confessions/stats", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Get total confessions
    let totalQuery = supabase.supabase
      .from("confessions")
      .select("id", { count: "exact", head: true });

    if (startDate) totalQuery = totalQuery.gte("confession_date", startDate);
    if (endDate) totalQuery = totalQuery.lte("confession_date", endDate);

    const { count: totalConfessions } = await totalQuery;

    // Get confessions by status
    let statusQuery = supabase.supabase.from("confessions").select("status");

    if (startDate) statusQuery = statusQuery.gte("confession_date", startDate);
    if (endDate) statusQuery = statusQuery.lte("confession_date", endDate);

    const { data: statusData } = await statusQuery;

    const statusCounts = statusData.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});

    // Get available slots count
    const { count: availableSlots } = await supabase.supabase
      .from("confession_availability_slots")
      .select("id", { count: "exact", head: true })
      .eq("status", "available");

    res.json({
      success: true,
      data: {
        totalConfessions,
        availableSlots,
        byStatus: statusCounts,
        scheduled: statusCounts.scheduled || 0,
        confirmed: statusCounts.confirmed || 0,
        completed: statusCounts.completed || 0,
        cancelled: statusCounts.cancelled || 0,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get user confession history
app.get("/api/users/:userId/confessions", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    const { data, error } = await supabase.supabase
      .from("confessions")
      .select(
        `
        *,
        confession_availability_slots:availability_slot_id (slot_date, start_time, location)
      `
      )
      .eq("user_id", userId)
      .order("confession_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =====================================================
// LEGACY ENDPOINTS (for backward compatibility)
// =====================================================

// Legacy: Add available slots
app.post("/addAvailableSlots", async (req, res) => {
  const startDate = "2024-06-01";
  const endDate = "2024-07-27";
  const targetDays = [5];
  const startTime = "18:00";
  const endTime = "20:45";
  const slotDuration = 15;

  const availableSlots = generateAvailableSlots(
    startDate,
    endDate,
    targetDays,
    startTime,
    endTime,
    slotDuration
  );

  const { data, error } = await supabase.supabase
    .from("confession_availability_slots")
    .insert(availableSlots);

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

// Legacy: Get available slots
app.get("/getAvailableSlots", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("confession_availability_slots")
    .select("*")
    .eq("status", "available");

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

// Legacy: Get confirmed confessions
app.get("/getConfirmedConfessionRequest", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("confessions")
    .select("*")
    .eq("status", "confirmed");

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

// Legacy: Get unconfirmed confessions
app.get("/getUnconfirmedConfessionRequest", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("confessions")
    .select("*")
    .eq("status", "scheduled");

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

// Legacy: Request confession
app.post("/requestConfession", async (req, res) => {
  try {
    const { user_id, slot_id } = req.body;

    // Use the new schedule endpoint logic
    const response = await fetch(
      `${req.protocol}://${req.get("host")}/api/confessions/schedule`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id,
          availability_slot_id: slot_id,
        }),
      }
    );

    const result = await response.json();

    if (result.success) {
      res.send(result.data);
    } else {
      res.status(500).send(result.message);
    }
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Legacy: Confirm confession
app.post("/confirmtConfession/:reservationId", async (req, res) => {
  const reservationId = req.params.reservationId;

  const { data, error } = await supabase.supabase
    .from("confessions")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", reservationId)
    .select();

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

module.exports = app;
