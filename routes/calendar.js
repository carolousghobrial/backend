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

module.exports = app;
