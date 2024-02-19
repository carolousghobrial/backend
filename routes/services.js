const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const { route } = require("./notifications");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addUserRole", async (req, res) => {
  const UserServiceRole = {
    user_id: req.body.user_id,
    role_id: req.body.role_id,
    service_id: req.body.service_id,
  };
  console.log(UserServiceRole);
  const { data, error } = await supabase.supabase
    .from("user_service_roles")
    .insert([UserServiceRole]);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.status(200);
  }
});

app.get("/getServices", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("services_table")
    .select("*");
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getUserServiceRoles/:user_id", async (req, res) => {
  const user_id = req.params.user_id;
  console.log(user_id);
  let { data: user_service_roles, error } = await supabase.supabase
    .from("user_service_roles")
    .select("*")
    .eq("user_id", user_id);

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(user_service_roles);
  }
});
app.get("/getRoles", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("roles_table")
    .select("*");
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

module.exports = app;
