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
app.post("/addUserRoleBulk", async (req, res) => {
  try {
    // Extract the array of users and common role/service info
    const { users, role_id, service_id } = req.body;

    // Validate input
    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        error: "Missing or invalid 'users' array in request body",
      });
    }

    if (!role_id || !service_id) {
      return res.status(400).json({
        error: "Missing required 'role_id' or 'service_id'",
      });
    }

    // Create array of user service roles for bulk insert
    const userServiceRoles = users.map((user_id) => ({
      user_id: user_id,
      role_id: role_id,
      service_id: service_id,
    }));

    console.log("Bulk inserting user service roles:", userServiceRoles);

    // Perform bulk insert
    const { data, error } = await supabase.supabase
      .from("user_service_roles")
      .insert(userServiceRoles)
      .select(); // Add select() to return the inserted data

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({
        error: error.message,
        details: error.details || "No additional details available",
      });
    }

    console.log("Successfully inserted:", data?.length || 0, "records");

    res.status(201).json({
      success: true,
      message: `Successfully added ${
        data?.length || userServiceRoles.length
      } user role assignments`,
      inserted_count: data?.length || userServiceRoles.length,
      data: data,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});
app.post("/updateUserRoleService", async (req, res) => {
  try {
    // Extract the array of users and common role/service info
    const { user_id, role_id, service_id } = req.body;
    if (!role_id || !service_id) {
      return res.status(400).json({
        error: "Missing required 'role_id' or 'service_id'",
      });
    }

    // Create array of user service roles for bulk insert
    const userServiceRole = {
      user_id: user_id,
      role_id: role_id,
      service_id: service_id,
    };

    // Perform bulk insert
    const { data, error } = await supabase.supabase
      .from("user_service_roles")
      .update({ service_id: service_id })
      .eq("user_id", user_id)
      .eq("role_id", role_id)
      .select(); // Add select() to return the inserted data

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({
        error: error.message,
        details: error.details || "No additional details available",
      });
    }

    console.log("Successfully inserted:", data?.length || 0, "records");

    res.status(201).json({
      success: true,
      message: `Successfully added ${
        data?.length || userServiceRoles.length
      } user role assignments`,
      inserted_count: data?.length || userServiceRoles.length,
      data: data,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
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
    .select("*");

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
app.get("/getDSTeachers", async (req, res) => {
  const { data: rpcData, error: rpcError } = await supabase.supabase.rpc(
    "get_deacon_school_teachers"
  );
  if (rpcError) {
    console.log(rpcError);
    res.status(500).send(rpcError.message);
  } else {
    res.send(rpcData);
  }
});
app.get("/getDSTeachersByLevel/:level", async (req, res) => {
  const level = req.params.level;
  console.log(level);
  const { data: rpcData, error: rpcError } = await supabase.supabase.rpc(
    "get_ds_teachers_by_level",
    { level: level }
  );
  console.log(rpcData);
  if (rpcError) {
    console.log(rpcError);
    res.status(500).send(rpcError.message);
  } else {
    res.send(rpcData);
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
  const { data: data, error: error } = await supabase.supabase
    .from("user_service_roles")
    .delete()
    .match({ id: id });

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send({ ok: true });
  }
});

module.exports = app;
