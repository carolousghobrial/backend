const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addPrayer", async (req, res) => {
  prayer = {
    full_name: req.body.full_name,
    email: req.body.email,
    cellphone: req.body.cellphone,
    message: req.body.message,
  };

  const { data, error } = await supabase.supabase
    .from("prayerRequests")
    .insert([prayer]);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

app.get("/getPrayers", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("prayerRequests")
    .select("*");
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.delete("/deletePrayer/:id", async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase.supabase
    .from("prayerRequests")
    .delete()
    .match({ id: id });

  if (error) {
    res.status(500).send(error.message);
  } else {
  }
});
app.post("/deletePrayers", async (req, res) => {
  try {
    console.log("here");
    const { ids } = req.body; // array of IDs
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: "ids must be an array" });
    }
    console.log(ids);
    // Example with Supabase
    const { data, error } = await supabase.supabase
      .from("prayerRequests")
      .delete()
      .in("id", ids);
    console.log(error);
    if (error) throw error;

    res.json({ success: true, deleted: data });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Failed to delete requests" });
  }
});

module.exports = app;
