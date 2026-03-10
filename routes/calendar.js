/**
 * calendarRouter.js
 *
 * Fix: incoming time strings are normalised to "HH:MM:SS" (24h local)
 * before being stored in Supabase, so the displayed time always matches
 * what the user picked.
 *
 * Root cause: AddCalendarPage.formatDate() was using timeZone:"UTC" which
 * shifted the user's local time into UTC before sending it. Fixed on the
 * frontend too (see AddCalendarPage fix below), but the backend now also
 * sanitises whatever it receives so old/mixed data still works.
 */

const express = require("express");
const app = express();
const supabase = require("../config/config");

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// ─── time normaliser ──────────────────────────────────────────────────────────
// Accepts any of:
//   "HH:MM:SS"            → returned as-is
//   "HH:MM"               → padded to "HH:MM:00"
//   "MM/DD/YYYY HH:MM:SS" → extracts the time portion
//   ISO string            → extracts LOCAL time (no UTC shift)
//   Date object           → extracts local HH:MM:SS
// Returns "HH:MM:SS" or null if unparseable.

function normaliseTime(val) {
  if (!val) return null;

  // Already "HH:MM:SS" or "HH:MM"
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(val).trim())) {
    const parts = String(val).trim().split(":");
    const h = parts[0].padStart(2, "0");
    const m = parts[1].padStart(2, "0");
    const s = (parts[2] ?? "00").padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  // "MM/DD/YYYY HH:MM:SS" — the format AddCalendarPage.formatDate() produces
  // e.g. "08/15/2024 14:00:00"
  const localeMatch = String(val).match(
    /\d{2}\/\d{2}\/\d{4}\s+(\d{2}):(\d{2}):(\d{2})/,
  );
  if (localeMatch) {
    return `${localeMatch[1]}:${localeMatch[2]}:${localeMatch[3]}`;
  }

  // ISO string or anything new Date() understands
  // ⚠️  Use getHours/getMinutes/getSeconds (LOCAL), NOT getUTCHours etc.
  const d = new Date(val);
  if (!isNaN(d)) {
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  console.warn("[calendarRouter] Could not parse time value:", val);
  return null;
}

// ─── routes ───────────────────────────────────────────────────────────────────

app.get("/getCalendar", async (req, res) => {
  const { data, error } = await supabase.supabase.from("calendar").select("*");
  if (error) return res.status(500).send(error.message);
  res.send(data);
});

app.get("/getEvent/:id", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("calendar")
    .select("*")
    .eq("id", req.params.id);
  if (error) return res.status(500).send(error.message);
  res.send(data);
});

app.get("/getCalendarByDate/:index", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("calendar")
    .select("*")
    .eq("eventDay", DAYS[req.params.index]);
  if (error) return res.status(500).send(error.message);
  res.send(data);
});

app.post("/addCalenderEvent", async (req, res) => {
  const event = {
    eventTitle: req.body.eventTitle,
    repeated: req.body.repeated,
    eventDay: req.body.eventDay,
    location: req.body.location ?? null,
    one_timeEventDate: req.body.one_timeEventDate ?? null,
    // ← normalise so what's stored always matches what the user picked
    starteventTime: normaliseTime(req.body.starteventTime),
    endeventTime: normaliseTime(req.body.endeventTime),
  };

  console.log("[addCalenderEvent] storing:", event);

  const { data, error } = await supabase.supabase
    .from("calendar")
    .insert(event)
    .select();

  if (error) {
    console.error(error);
    return res.status(500).send(error.message);
  }
  res.send(data);
});

app.post("/updateCalenderEvent/:index", async (req, res) => {
  const id = parseInt(req.params.index, 10);

  const event = {
    eventTitle: req.body.eventTitle,
    repeated: req.body.repeated,
    eventDay: req.body.eventDay,
    location: req.body.location ?? null,
    one_timeEventDate: req.body.one_timeEventDate ?? null,
    // ← same normalisation on update
    starteventTime: normaliseTime(req.body.starteventTime),
    endeventTime: normaliseTime(req.body.endeventTime),
  };

  console.log("[updateCalenderEvent] id:", id, "storing:", event);

  const { data, error } = await supabase.supabase
    .from("calendar")
    .update(event)
    .eq("id", id)
    .select();

  if (error) {
    console.error(error);
    return res.status(500).send(error.message);
  }
  res.send(data);
});

app.delete("/deleteCalenderEvent/:index", async (req, res) => {
  const { error } = await supabase.supabase
    .from("calendar")
    .delete()
    .match({ id: req.params.index });

  if (error) {
    console.error(error);
    return res.status(500).send(error.message);
  }
  res.send({ success: true });
});

module.exports = app;
