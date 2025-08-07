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
    level: level,
  };
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
  let level = req.body.level;

  switch (level) {
    case "Alpha":
      level = 1;
      break;
    case "Beta":
      level = 2;
      break;
    case "Graduates":
      level = 13;
      break;
    default:
      level = parseInt(level, 10) + 2;
      break;
  }

  const body = {
    user_id: req.body.teacher_id,
    role_id: req.body.role,
    service_id: req.body.service_id, // numeric level after switch
  };

  console.log("Inserting teacher with body:", body);

  const { data, error } = await supabase.supabase
    .from("ds_teachers")
    .insert([body], { onConflict: ["teacher_id"] })
    .select();

  if (error) {
    console.error("Supabase insert error:", error);
    res.status(500).send(error.message);
  } else {
    res.send(data);
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
