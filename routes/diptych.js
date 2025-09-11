const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");

app.post("/adddiptych", async (req, res) => {
  diptych = {
    departed_name: req.body.departed_name,
    departed_relatives: req.body.departed_relatives,
    memorial_type: req.body.memorial_type,
    liturgy_date: req.body.liturgy_date,
  };
  console.log(diptych);
  const { data, error } = await supabase.supabase
    .from("diptych")
    .insert([diptych]);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

app.get("/getdiptychs", async (req, res) => {
  const { data, error } = await supabase.supabase.from("diptych").select("*");
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.delete("/deletediptych/:id", async (req, res) => {
  const id = req.params.id;
  console.log(id);
  const { data, error } = await supabase.supabase
    .from("diptych")
    .delete()
    .match({ id: id });

  console.log(data);
  if (error) {
    res.status(500).send(error.message);
  } else {
  }
});
app.post("/deleteDiptychs", async (req, res) => {
  try {
    console.log("here");
    const { ids } = req.body; // array of IDs
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: "ids must be an array" });
    }
    console.log(ids);
    // Example with Supabase
    const { data, error } = await supabase.supabase
      .from("diptych")
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
