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
app.get("/getHymnsByLevel/:level", async (req, res) => {
  const level = req.params.level;
  console.log(level);
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .eq("level_hymn_in", level);
  console.log(data);
  console.log(error);
  res.send(data);
});
app.get("/getHymn/:id", async (req, res) => {
  const id = req.params.id;
  console.log(id);
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .eq("id", id)
    .single();

  console.log(data);
  console.log(error);
  res.send(data);
});
app.get("/getRitualsByLevel/:level", async (req, res) => {
  const level = req.params.level;
  console.log(level);
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_rituals")
    .select("*")
    .eq("level", level);
  console.log(data);
  console.log(error);
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
  console.log(level);
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_altar_responses")
    .select("*")
    .eq("level", level);
  console.log(data);
  console.log(error);
  res.send(data);
  //res.ok();
});
app.get("/getAltarResponse/:id", async (req, res) => {
  const id = req.params.id;
  console.log(id);
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_altar_responses")
    .select("*")
    .eq("id", id)
    .single();

  console.log(data);
  console.log(error);
  res.send(data);
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
    .from("deacons_school_hymns")
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
    .from("deacons_school_hymns")
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
  const { data: data, error: error } = await supabase.supabase
    .from("deacons_school_hymns")
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
