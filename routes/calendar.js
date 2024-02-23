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

app.post("/addEvent", async (req, res) => {});

app.get("/getEvent/:id", async (req, res) => {
  let { data: calendar, error } = await supabase.supabase
    .from("calendar")
    .select("*")
    .eq("id", req.params.id);
  res.send(calendar);
});
app.get("/", (req, res) => {
  res.send("Hello, Announcment!");
});
app.get("/getCalendar", async (req, res) => {
  let { data: calendar, error } = await supabase.supabase
    .from("calendar")
    .select("*");

  res.send(calendar);
});
app.get("/getCalendarByDate/:index", async (req, res) => {
  let { data: calendar, error } = await supabase.supabase
    .from("calendar")
    .select("*")
    .eq("eventDay", daysOfWeek[req.params.index]);

  res.send(calendar);
});
app.post("/updateCalenderEvent/:index", async (req, res) => {
  const id = req.params.index;
  console.log(req.body);
  const CalendarEvent = {
    id: req.body.id,
    eventTitle: req.body.eventTitle,
    repeated: req.body.repeatedStatus,
    starteventTime: req.body.starteventTime,
    location: req.body.location,
    endeventTime: req.body.endeventTime,
    one_timeEventDate: req.body.one_timeEventDate,
  };
  const { data: updatedData, error: updateError } = await supabase.supabase
    .from("calendar")
    .update(CalendarEvent)
    .eq("id", id)
    .select();
  if (updateError) {
    res.status(500).send(error.message);
  } else {
    res.send(updatedData);
  }
});
app.delete("/deleteCalenderEvent/:index", async (req, res) => {
  const id = req.params.index;

  const { data: updatedData, error: updateError } = await supabase.supabase
    .from("calendar")
    .delete()
    .match({ id: id });
  console.log(updateError);
  if (updateError) {
    res.status(500).send(error.message);
  } else {
    res.send(updatedData);
  }
});
app.post("/addCalenderEvent", async (req, res) => {
  const CalendarEvent = {
    eventTitle: req.body.eventTitle,
    repeated: req.body.repeated,
    starteventTime: req.body.starteventTime,
    endeventTime: req.body.endeventTime,
    location: req.body.location,

    one_timeEventDate: req.body.one_timeEventDate,
    eventDay: req.body.eventDay,
  };
  console.log(CalendarEvent);
  const { data: data, error: error } = await supabase.supabase
    .from("calendar")
    .insert(CalendarEvent)
    .select();
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

module.exports = app;
