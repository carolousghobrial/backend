const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addPrayer", async (req, res) => {
  prayer = {
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
  console.log(data);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.delete("/deletePrayer/:id", async (req, res) => {
  const id = req.params.id;
  console.log(id);
  const { data, error } = await supabase.supabase
    .from("prayerRequests")
    .delete()
    .match({ id: id });

  console.log(data);
  if (error) {
    res.status(500).send(error.message);
  } else {
  }
});

module.exports = app;
