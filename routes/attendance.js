const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const { decode } = require("base64-arraybuffer");
const axios = require("axios");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/recordAttendance", async (req, res) => {
  try {
    const attendancePromises = req.body.peoplePresent.map(async (person) => {
      const attendance = {
        service_id: req.body.service,
        seravantTakenAttendance: req.body.seravantTakenAttendance,
        taken_on: req.body.taken_on,
        user_id: person,
      };
      const { data, error } = await supabase.supabase
        .from("attendance")
        .insert([attendance]);

      if (error) {
        throw new Error(error.message);
      }
      return data;
    });

    const attendanceResults = await Promise.all(attendancePromises);
    res.send({ ok: true });
  } catch (error) {
    console.error("Error:", error.message);
    res
      .status(500)
      .send({ error: "An error occurred while processing the request" });
  }

  // attendance.peoplePresent.map((person) => {});
});

module.exports = app;
