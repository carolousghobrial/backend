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

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addRequest", async (req, res) => {
  request = {
    name: req.body.name,
    cellphone: req.body.cellphone,
    church_service: req.body.itemPassed,
  };
  const { data, error } = await supabase.supabase
    .from("join_service_request")
    .insert([request]);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

app.get("/getRequests", authenticateToken, async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("join_service_request")
    .select("*");
  console.log(error);
  console.log(data);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.delete("/deleteRequest/:id", authenticateToken, async (req, res) => {
  const id = req.params.id;
  console.log(id);
  const { data, error } = await supabase.supabase
    .from("join_service_request")
    .delete()
    .match({ id: id });

  if (error) {
    res.status(500).send(error.message);
  } else {
  }
});

module.exports = app;
