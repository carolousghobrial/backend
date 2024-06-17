const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const moment = require("moment");

app.get("/", (req, res) => {
  res.send("Hello World!");
});
// Define parameters
function generateAvailableSlots(
  startDate,
  endDate,
  targetDays,
  startTime,
  endTime,
  slotDuration
) {
  const availableSlots = [];

  // Iterate over the range of dates
  for (
    let date = moment(startDate);
    date.isSameOrBefore(endDate);
    date.add(1, "day")
  ) {
    // Check if the current date matches any of the target days
    if (targetDays.includes(date.day())) {
      // Generate time slots for the current date
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
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
function generateTimeSlots(date, startTime, endTime, slotDuration) {
  const slots = [];
  let currentTime = moment(date + " " + startTime, "YYYY-MM-DD HH:mm");
  const endTimeMoment = moment(date + " " + endTime, "YYYY-MM-DD HH:mm");

  while (currentTime.isSameOrBefore(endTimeMoment)) {
    slots.push({
      date: currentTime.format("YYYY-MM-DD"),
      day_of_week: dayNames[currentTime.day()],
      start_time: currentTime.format("HH:mm"),
      end_time: currentTime
        .add(slotDuration, "minutes")
        .format("YYYY-MM-DD HH:mm"),
      available: true,
    });
  }

  return slots;
}

app.post("/addAvailableSlots", async (req, res) => {
  // Example usage
  const startDate = "2024-06-01";
  const endDate = "2024-07-27";
  const targetDays = [5]; // Sundays and Thursdays
  const startTime = "18:00"; // Start time for slots
  const endTime = "20:45"; // End time for slots
  const slotDuration = 15; // Slot duration in minutes

  const availableSlots = generateAvailableSlots(
    startDate,
    endDate,
    targetDays,
    startTime,
    endTime,
    slotDuration
  );
  //res.send(availableSlots);
  const { data, error } = await supabase.supabase
    .from("confession_slots")
    .insert(availableSlots);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

app.get("/getAvailableSlots", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("confession_slots")
    .select("*")
    .eq("available", true);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getConfirmedConfessionRequest", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("confession_reservation")
    .select("*")
    .eq("confirmed", true);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getUnconfirmedConfessionRequest", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("confession_reservation")
    .select("*")
    .eq("confirmed", false);

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.post("/requestConfession", async (req, res) => {
  const confessionRequest = {
    user_id: req.body.user_id,
    slot_id: req.body.slot_id,
  };
  console.log(confessionRequest);
  const { data, error } = await supabase.supabase
    .from("confession_reservation")
    .insert([confessionRequest]);
  console.log(error);
  if (error) {
    console.log(error);

    res.status(500).send(error.message);
  } else {
    const { data: updatedData, error: updateError } = await supabase.supabase
      .from("confession_slots")
      .update({ available: false })
      .eq("id", req.body.slot_id)
      .select();
    if (updateError) {
      res.status(500).send(error.message);
    } else {
      res.send(updatedData);
    }
  }
});
app.post("/confirmtConfession/:reservationId", async (req, res) => {
  const reservationId = req.params.reservationId;
  const { data: data, error: error } = await supabase.supabase
    .from("confession_reservation")
    .update({ confirmed: true })
    .eq("id", reservationId)
    .select();

  if (error) {
    console.log("HEREE");
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

module.exports = app;
