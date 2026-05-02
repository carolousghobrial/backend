const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, error: "Unauthorized" });
  try {
    const {
      data: { user },
      error,
    } = await supabase.supabase.auth.getUser(token);
    if (error || !user)
      return res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    return res
      .status(403)
      .json({ success: false, error: "Token verification failed" });
  }
};

// ── Contact Messages ──────────────────────────────────────────────────────────

app.post("/addMessage", async (req, res) => {
  const { firstName, lastName, cellphone, email, title, message } = req.body;
  if (!firstName || !lastName || !message) {
    return res
      .status(400)
      .json({
        success: false,
        error: "firstName, lastName, and message are required",
      });
  }
  const { data, error } = await supabase.supabase
    .from("contact_messages")
    .insert([
      {
        first_name: firstName,
        last_name: lastName,
        cellphone,
        email,
        title,
        message,
      },
    ])
    .select()
    .single();
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.status(201).json({ success: true, data });
});

app.get("/getMessage/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.supabase
    .from("contact_messages")
    .select("*")
    .eq("id", id)
    .single();
  if (error)
    return res.status(404).json({ success: false, error: "Message not found" });
  res.json({ success: true, data });
});

app.get("/getMessages", authenticateToken, async (req, res) => {
  const { page = 0, limit = 100 } = req.query;
  const pageNum = Math.max(0, parseInt(page, 10) || 0);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  const from = pageNum * limitNum;
  const to = from + limitNum - 1;
  const { data, error, count } = await supabase.supabase
    .from("contact_messages")
    .select(
      "id, first_name, last_name, cellphone, email, title, message, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({
    success: true,
    data,
    pagination: { page: pageNum, limit: limitNum, total: count },
  });
});

app.delete("/deleteMessage/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.supabase
    .from("contact_messages")
    .delete()
    .eq("id", id);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

// ── Prayer Requests (delegates to prayerRequests table) ───────────────────────
// Note: canonical prayer request routes live at /prayers — these are kept for
// backwards-compatibility only.

app.post("/addprayerRequest", async (req, res) => {
  const { title, message, full_name, email } = req.body;
  if (!message)
    return res
      .status(400)
      .json({ success: false, error: "message is required" });
  const { data, error } = await supabase.supabase
    .from("prayerRequests")
    .insert([{ title, message, full_name, email }])
    .select()
    .single();
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.status(201).json({ success: true, data });
});

app.get("/getprayerRequest/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.supabase
    .from("prayerRequests")
    .select("id, title, message, full_name, email, created_at")
    .eq("id", id)
    .single();
  if (error)
    return res.status(404).json({ success: false, error: "Not found" });
  res.json({ success: true, data });
});

app.get("/getprayerRequests", authenticateToken, async (req, res) => {
  const { page = 0, limit = 100 } = req.query;
  const pageNum = Math.max(0, parseInt(page, 10) || 0);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  const { data, error, count } = await supabase.supabase
    .from("prayerRequests")
    .select("id, title, message, full_name, email, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(pageNum * limitNum, pageNum * limitNum + limitNum - 1);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({
    success: true,
    data,
    pagination: { page: pageNum, limit: limitNum, total: count },
  });
});

app.delete("/deleteprayerRequest/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.supabase
    .from("prayerRequests")
    .delete()
    .eq("id", id);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

// ── Diptych Requests (delegates to diptych table) ────────────────────────────

app.post("/addDiptychRequest", async (req, res) => {
  const { firstName, lastName, dateOfLiturgy, diptychtype, message } = req.body;
  if (!firstName || !lastName) {
    return res
      .status(400)
      .json({ success: false, error: "firstName and lastName are required" });
  }
  const { data, error } = await supabase.supabase
    .from("diptych")
    .insert([
      {
        departed_name: `${firstName} ${lastName}`,
        liturgy_date: dateOfLiturgy,
        memorial_type: diptychtype,
        notes: message,
      },
    ])
    .select()
    .single();
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.status(201).json({ success: true, data });
});

app.get("/getDiptychRequest/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.supabase
    .from("diptych")
    .select("id, departed_name, liturgy_date, memorial_type, notes, created_at")
    .eq("id", id)
    .single();
  if (error)
    return res.status(404).json({ success: false, error: "Not found" });
  res.json({ success: true, data });
});

app.get("/getdiptychRequests", authenticateToken, async (req, res) => {
  const { page = 0, limit = 100 } = req.query;
  const pageNum = Math.max(0, parseInt(page, 10) || 0);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  const { data, error, count } = await supabase.supabase
    .from("diptych")
    .select(
      "id, departed_name, liturgy_date, memorial_type, notes, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(pageNum * limitNum, pageNum * limitNum + limitNum - 1);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({
    success: true,
    data,
    pagination: { page: pageNum, limit: limitNum, total: count },
  });
});

app.delete("/deletediptychRequest/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.supabase
    .from("diptych")
    .delete()
    .eq("id", id);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

module.exports = app;
