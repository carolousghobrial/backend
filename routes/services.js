const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const { route } = require("./notifications");
const moment = require("moment-timezone");
const axios = require("axios");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addUserRole", async (req, res) => {
  const UserServiceRole = {
    user_id: req.body.user_id,
    role_id: req.body.role_id,
    service_id: req.body.service_id,
  };
  const { data, error } = await supabase.supabase
    .from("user_service_roles")
    .insert([UserServiceRole]);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.post("/addserviceLesson", async (req, res) => {
  const serviceLesson = {
    service: req.body.service,
    title: req.body.title,
    description: req.body.description,
    verse: req.body.verse,
    date_of_lesson: req.body.date_of_lesson,
    assignee: req.body.assignee,
  };

  const { data, error } = await supabase.supabase
    .from("service_lesson")
    .insert([serviceLesson]);
  if (error) {
    console.log(error);
    res.status(500).send(error.message);
  } else {
    // Send push notification
    const requestBody = {
      title: "New Sunday School Lesson",
      body: serviceLesson.title,
    };

    const response = await axios.post(
      `http://localhost:3000/notifications/sendSubscribedServicePushNotification/${req.body.service}`,
      requestBody
    );

    res.send(data);
  }
});

app.get("/getServices", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("services_table")
    .select("*")
    .not("service_id", "ilike", "%ds_level%");
  console.log(data);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getServiceById/:id", async (req, res) => {
  const serviceId = req.params.id;
  const { data, error } = await supabase.supabase
    .from("services_table")
    .select("*")
    .eq("service_id", serviceId)
    .single();

  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getDeaconsSchoolClasses", async (req, res) => {
  const serviceId = req.params.id;
  const { data, error } = await supabase.supabase
    .from("services_table")
    .select("*")
    .ilike("service_id", "%ds_%"); // %keyword% means contains keyword

  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getServiceLessons/:serviceId", async (req, res) => {
  const serviceId = req.params.serviceId;
  const { data, error } = await supabase.supabase
    .from("service_lesson")
    .select("*")
    .eq("service", serviceId);

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getServiceLessonOfWeek/:serviceId", async (req, res) => {
  const serviceId = req.params.serviceId;

  try {
    // Get the start and end of the current week in the desired time zone
    const startOfWeek = moment().tz("America/Chicago").startOf("week");
    const endOfWeek = moment().tz("America/Chicago").endOf("week");
    // Construct the SQL query to filter rows for the current week in the desired time zone
    const { data, error } = await supabase.supabase
      .from("service_lesson")
      .select("*")
      .eq("service", serviceId)
      .gte("date_of_lesson", startOfWeek.toISOString()) // Start of the week
      .lte("date_of_lesson", endOfWeek.toISOString()) // End of the week
      .single();
    if (error) {
      res.status(500).send(error.message);
    } else {
      res.send(data);
    }
  } catch (error) {
    res.status(500).send(error.message);
  }
});
app.get("/getUserServiceRoles/:user_id", async (req, res) => {
  const user_id = req.params.user_id;
  console.log(user_id);
  let { data: user_service_roles, error } = await supabase.supabase
    .from("user_service_roles")
    .select("*")
    .eq("user_id", user_id);

  console.log(user_service);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(user_service_roles);
  }
});
app.get("/getServiceServants/:service_id", async (req, res) => {
  const service_id = req.params.service_id;
  let { data: user_service_roles, error } = await supabase.supabase
    .from("user_service_roles")
    .select("*")
    .eq("service_id", service_id)
    .neq("role_id", "congregant")
    .neq("role_id", "member");

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(user_service_roles);
  }
});
app.get("/getServiceMembers/:service_id", async (req, res) => {
  const service_id = req.params.service_id;
  console.log(service_id);

  let { data: myData, error } = await supabase.supabase
    .from("user_service_roles")
    .select("*")
    .eq("service_id", service_id)
    .eq("role_id", "congregant");

  if (error) {
    console.log(error);
    res.status(500).send(error.message);
  } else {
    res.send(myData);
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
app.delete("/deleteUserRole/:id", async (req, res) => {
  const id = req.params.id;
  console.log(id);
  const { data: data, error: error } = await supabase.supabase
    .from("user_service_roles")
    .delete()
    .match({ id: id });
  console.log(data);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send({ ok: true });
  }
});

module.exports = app;
