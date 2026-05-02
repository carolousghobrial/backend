const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Access token is required" });
  }
  try {
    const {
      data: { user },
      error,
    } = await supabase.supabase.auth.getUser(token);
    if (error || !user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token" });
    }
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    return res
      .status(403)
      .json({ success: false, message: "Token verification failed" });
  }
};

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

app.get("/getdiptychs", authenticateToken, async (req, res) => {
  const { data, error } = await supabase.supabase.from("diptych").select("*");
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.delete("/deletediptych/:id", authenticateToken, async (req, res) => {
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
app.post("/deleteDiptychs", authenticateToken, async (req, res) => {
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
