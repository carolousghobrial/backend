const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const moment = require("moment");

app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function generateAvailableSlots(
  startDate,
  endDate,
  targetDays,
  startTime,
  endTime,
  slotDuration,
) {
  const slots = [];
  for (
    let date = moment(startDate);
    date.isSameOrBefore(endDate);
    date.add(1, "day")
  ) {
    if (targetDays.includes(date.day())) {
      const currentDate = date.format("YYYY-MM-DD");
      let current = moment(`${currentDate} ${startTime}`, "YYYY-MM-DD HH:mm");
      const end = moment(`${currentDate} ${endTime}`, "YYYY-MM-DD HH:mm");
      while (current.isBefore(end)) {
        const slotEnd = current.clone().add(slotDuration, "minutes");
        slots.push({
          date: current.format("YYYY-MM-DD"),
          day_of_week: dayNames[current.day()],
          start_time: current.format("HH:mm"),
          end_time: slotEnd.format("HH:mm"),
          available: true,
        });
        current = slotEnd;
      }
    }
  }
  return slots;
}

// ==================== SLOTS ====================

/** GET all available slots */
app.get("/getAvailableSlots", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("visitation_slots")
    .select("*")
    .eq("available", true)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error)
    return res.status(500).json({ success: false, message: error.message });
  res.json(data);
});

/** GET all slots (for priest availability management) */
app.get("/getAllSlots", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("visitation_slots")
    .select("*")
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error)
    return res.status(500).json({ success: false, message: error.message });
  res.json(data);
});

/** POST bulk-generate slots from a date range + days + times */
app.post("/addAvailableSlots", async (req, res) => {
  const {
    startDate = "2024-06-01",
    endDate = "2024-07-27",
    targetDays = [0, 3, 4], // Sun, Wed, Thu
    startTime = "18:00",
    endTime = "21:00",
    slotDuration = 60,
  } = req.body;

  const slots = generateAvailableSlots(
    startDate,
    endDate,
    targetDays,
    startTime,
    endTime,
    slotDuration,
  );
  const { data, error } = await supabase.supabase
    .from("visitation_slots")
    .insert(slots)
    .select();
  if (error)
    return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, count: slots.length, data });
});

/** POST add a single custom slot (priest sets one specific time) */
app.post("/addSingleSlot", async (req, res) => {
  const { date, start_time, end_time } = req.body;
  if (!date || !start_time) {
    return res
      .status(400)
      .json({ success: false, message: "date and start_time are required" });
  }
  const slot = {
    date,
    day_of_week: dayNames[moment(date).day()],
    start_time,
    end_time:
      end_time ||
      moment(`${date} ${start_time}`, "YYYY-MM-DD HH:mm")
        .add(60, "minutes")
        .format("HH:mm"),
    available: true,
  };
  const { data, error } = await supabase.supabase
    .from("visitation_slots")
    .insert([slot])
    .select()
    .single();
  if (error)
    return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
});

/** DELETE a slot */
app.delete("/deleteSlot/:id", async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.supabase
    .from("visitation_slots")
    .delete()
    .eq("id", id);
  if (error)
    return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true });
});

// ==================== REQUESTS ====================

/** GET confirmed visitation requests (with slot info) */
app.get("/getConfirmedVisitationRequest", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("visitation_reservation")
    .select("*, visitation_slots(*)")
    .eq("confirmed", true)
    .order("created_at", { ascending: false });
  if (error)
    return res.status(500).json({ success: false, message: error.message });
  res.json(data);
});

/** GET unconfirmed / pending visitation requests */
app.get("/getUnconfirmedVisitationRequest", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("visitation_reservation")
    .select("*, visitation_slots(*)")
    .eq("confirmed", false)
    .eq("rejected", false)
    .order("created_at", { ascending: false });
  if (error)
    return res.status(500).json({ success: false, message: error.message });
  res.json(data);
});

/** GET all requests (priest dashboard) */
app.get("/getAllRequests", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("visitation_reservation")
    .select("*, visitation_slots(*)")
    .order("created_at", { ascending: false });
  if (error)
    return res.status(500).json({ success: false, message: error.message });
  res.json(data);
});

/** POST congregation requests a visitation slot */
app.post("/requestVisitation", async (req, res) => {
  const { user_id, slot_id, reason, address } = req.body;
  if (!user_id || !slot_id) {
    return res
      .status(400)
      .json({ success: false, message: "user_id and slot_id are required" });
  }

  // Insert reservation
  const { data: reservation, error: resError } = await supabase.supabase
    .from("visitation_reservation")
    .insert([
      { user_id, slot_id, reason, address, confirmed: false, rejected: false },
    ])
    .select()
    .single();

  if (resError)
    return res.status(500).json({ success: false, message: resError.message });

  // Mark slot as unavailable
  await supabase.supabase
    .from("visitation_slots")
    .update({ available: false })
    .eq("id", slot_id);

  res.json({ success: true, data: reservation });
});

/** POST priest manually creates a visitation (no slot required) */
app.post("/addManualVisitation", async (req, res) => {
  const { user_id, date, time, reason, address, notes } = req.body;
  if (!user_id || !date || !time) {
    return res
      .status(400)
      .json({
        success: false,
        message: "user_id, date, and time are required",
      });
  }

  // Create a slot first
  const slot = {
    date,
    day_of_week: dayNames[moment(date).day()],
    start_time: time,
    end_time: moment(`${date} ${time}`, "YYYY-MM-DD HH:mm")
      .add(60, "minutes")
      .format("HH:mm"),
    available: false,
  };
  const { data: newSlot, error: slotError } = await supabase.supabase
    .from("visitation_slots")
    .insert([slot])
    .select()
    .single();
  if (slotError)
    return res.status(500).json({ success: false, message: slotError.message });

  // Create confirmed reservation directly
  const { data: reservation, error: resError } = await supabase.supabase
    .from("visitation_reservation")
    .insert([
      {
        user_id,
        slot_id: newSlot.id,
        reason,
        address,
        notes,
        confirmed: true,
        rejected: false,
      },
    ])
    .select()
    .single();

  if (resError)
    return res.status(500).json({ success: false, message: resError.message });
  res.json({ success: true, data: reservation });
});

/** POST priest confirms a request */
app.post("/confirmVisitation/:reservationId", async (req, res) => {
  const { reservationId } = req.params;
  const { data, error } = await supabase.supabase
    .from("visitation_reservation")
    .update({ confirmed: true, rejected: false })
    .eq("id", reservationId)
    .select()
    .single();
  if (error)
    return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
});

/** POST priest rejects a request (frees the slot back up) */
app.post("/rejectVisitation/:reservationId", async (req, res) => {
  const { reservationId } = req.params;

  // Get slot_id first so we can free it
  const { data: existing } = await supabase.supabase
    .from("visitation_reservation")
    .select("slot_id")
    .eq("id", reservationId)
    .single();

  const { data, error } = await supabase.supabase
    .from("visitation_reservation")
    .update({ rejected: true, confirmed: false })
    .eq("id", reservationId)
    .select()
    .single();

  if (error)
    return res.status(500).json({ success: false, message: error.message });

  // Free the slot back up
  if (existing?.slot_id) {
    await supabase.supabase
      .from("visitation_slots")
      .update({ available: true })
      .eq("id", existing.slot_id);
  }

  res.json({ success: true, data });
});

/** PUT priest reschedules a request to a different slot */
app.put("/rescheduleVisitation/:reservationId", async (req, res) => {
  const { reservationId } = req.params;
  const { new_slot_id, notes } = req.body;
  if (!new_slot_id)
    return res
      .status(400)
      .json({ success: false, message: "new_slot_id is required" });

  // Free old slot
  const { data: existing } = await supabase.supabase
    .from("visitation_reservation")
    .select("slot_id")
    .eq("id", reservationId)
    .single();

  if (existing?.slot_id) {
    await supabase.supabase
      .from("visitation_slots")
      .update({ available: true })
      .eq("id", existing.slot_id);
  }

  // Update reservation
  const { data, error } = await supabase.supabase
    .from("visitation_reservation")
    .update({ slot_id: new_slot_id, confirmed: true, notes: notes || null })
    .eq("id", reservationId)
    .select("*, visitation_slots(*)")
    .single();

  if (error)
    return res.status(500).json({ success: false, message: error.message });

  // Mark new slot unavailable
  await supabase.supabase
    .from("visitation_slots")
    .update({ available: false })
    .eq("id", new_slot_id);

  res.json({ success: true, data });
});

// Legacy alias
app.post("/confirmtVisitation/:reservationId", async (req, res) => {
  req.url = `/confirmVisitation/${req.params.reservationId}`;
  app.handle(req, res);
});

module.exports = app;
