const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const notifications = require("./notifications");
const { decode } = require("base64-arraybuffer");
const axios = require("axios");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addAnnouncment", async (req, res) => {
  try {
    // Extract announcement data from request body
    const {
      english_title,
      english_description,
      arabic_title,
      arabic_description,
      url,
      valid,
      image_url,
    } = req.body;

    // Insert announcement into database
    const { data, error } = await supabase.supabase
      .from("announcments")
      .insert([
        {
          english_title,
          english_description,
          arabic_title,
          arabic_description,
          url,
          valid,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new Error("Error inserting announcement into database");
    }

    // Upload image to Superbase Storage
    const { data: fileData, error: uploadError } =
      await supabase.supabase.storage
        .from("announcments")
        .upload(data.id, decode(image_url), { contentType: "image/png" });

    if (uploadError) {
      throw new Error("Error uploading image to storage");
    }

    // Get public URL of the uploaded image
    const fileURL = await supabase.supabase.storage
      .from("announcments")
      .getPublicUrl(data.id);
    const newFileURL = fileURL.data.publicUrl;

    // Update announcement with image URL in database
    const { updatedData, updatedError } = await supabase.supabase
      .from("announcments")
      .update({ image_url: newFileURL })
      .eq("id", data.id)
      .select()
      .single();

    // // Send push notification
    // const requestBody = {
    //   title: english_title,
    //   body: english_description,
    // };
    // const response = await axios.post(
    //   "http://localhost:3000/notifications/sendPushNotification",
    //   requestBody
    // );
    res.send({ ok: true });
  } catch (error) {
    console.error("Error:", error.message);
    res
      .status(500)
      .send({ error: "An error occurred while processing the request" });
  }
});
app.post("/editAnnouncment/:id", async (req, res) => {
  try {
    // Extract announcement data from request body
    const id = req.params.id;
    const {
      english_title,
      english_description,
      arabic_title,
      arabic_description,
      url,
      valid,
      image_url,
    } = req.body;
    // Insert announcement into database
    const { data, error } = await supabase.supabase
      .from("announcments")
      .update([
        {
          english_title,
          english_description,
          arabic_title,
          arabic_description,
          url,
          valid,
        },
      ])
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw new Error("Error inserting announcement into database");
    }

    // Upload image to Superbase Storage
    const { data: fileData, error: uploadError } =
      await supabase.supabase.storage
        .from("announcments")
        .update(id, decode(image_url), { contentType: "image/png" });

    if (uploadError) {
      console.log(uploadError);
      throw new Error("Error uploading image to storage");
    }

    // Get public URL of the uploaded image
    const fileURL = await supabase.supabase.storage
      .from("announcments")
      .getPublicUrl(id);
    const newFileURL = fileURL.data.publicUrl;

    // Update announcement with image URL in database
    const { updatedData, updatedError } = await supabase.supabase
      .from("announcments")
      .update({ image_url: newFileURL })
      .eq("id", id)
      .select()
      .single();

    if (updatedError) {
      console.log(updatedError);
      throw new Error("Error updating image URL in database");
    }

    // Send push notification
    const requestBody = {
      title: updatedData.english_title,
      body: updatedData.english_description,
    };

    const response = await axios.post(
      "http://localhost:3000/notifications/sendPushNotification",
      requestBody
    );

    res.send({ ok: true });
  } catch (error) {
    console.error("Error:", error.message);
    res
      .status(500)
      .send({ error: "An error occurred while processing the request" });
  }
});

app.get("/getAnnouncment/:id", async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase.supabase
    .from("announcments")
    .select("*")
    .eq("id", id); // Correct
  res.send(data);
});

app.get("/getAnnouncments", async (req, res) => {
  let { data: mainAnnouncments, error } = await supabase.supabase
    .from("announcments")
    .select("*");

  res.send(mainAnnouncments);
});
app.get("/getValidAnnouncments", async (req, res) => {
  const mydate = new Date();

  const { data, error } = await supabase.supabase
    .from("announcments")
    .select("*")
    .eq("valid", true);

  res.send(data);
});

app.post("/toggleValid", async (req, res) => {
  const body = {
    id: req.body.id,
    newStatus: req.body.newStatus,
    tableName: req.body.tableName,
  };
  console.log(body.newStatus);
  console.log(body.id);
  const { data: data, error: updateError } = await supabase.supabase
    .from(body.tableName)
    .update({ valid: body.newStatus })
    .eq("id", body.id)
    .select()
    .single();
  if (updateError) {
    console.log(updateError);
    res.status(500).send(updateError.message);
  } else {
    console.log(data);
    res.send(data);
  }
});

app.get("/getValidServiceAnnouncments/:id", async (req, res) => {
  const mydate = new Date();
  const id = req.params.id;
  console.log(id);
  const { data, error } = await supabase.supabase
    .from("service_announcements")
    .select("*")
    .eq("service_id", id)
    .eq("valid", true);

  res.send(data);
});
app.post("/addServiceAnnouncment", async (req, res) => {
  try {
    // Extract announcement data from request body
    const announcement = {
      service_id: req.body.service_id,
      message: req.body.message,
      url: req.body.url,
      valid: true,
      image_url: req.body.image_url,
    };
    console.log(announcement);
    // Insert announcement into database
    const { data, error } = await supabase.supabase
      .from("service_announcements")
      .insert([announcement])
      .select()
      .single();

    if (error) {
      console.log(error);
      throw new Error("Error inserting announcement into database");
    }

    // Upload image to Superbase Storage
    const { data: fileData, error: uploadError } =
      await supabase.supabase.storage
        .from("service_announcements")
        .upload(data.id, decode(announcement.image_url), {
          contentType: "image/png",
        });

    if (uploadError) {
      console.log(uploadError);
      throw new Error("Error uploading image to storage");
    }

    // Get public URL of the uploaded image
    const fileURL = await supabase.supabase.storage
      .from("service_announcements")
      .getPublicUrl(data.id);
    const newFileURL = fileURL.data.publicUrl;

    // Update announcement with image URL in database
    const { updatedData, updatedError } = await supabase.supabase
      .from("service_announcements")
      .update({ image_url: newFileURL })
      .eq("id", data.id)
      .select()
      .single();

    if (updatedError) {
      throw new Error("Error updating image URL in database");
    }

    // Send push notification
    const requestBody = {
      title: updatedData.m,
      body: updatedData.english_description,
    };

    const response = await axios.post(
      "http://localhost:3000/notifications/sendPushNotification",
      requestBody
    );

    res.send({ ok: true });
  } catch (error) {
    console.error("Error:", error.message);
    res
      .status(500)
      .send({ error: "An error occurred while processing the request" });
  }
});
app.get("/getServiceAnnouncments/:id", async (req, res) => {
  const mydate = new Date();
  const id = req.params.id;
  const { data, error } = await supabase.supabase
    .from("service_announcements")
    .select("*")
    .eq("service_id", id);

  res.send(data);
});
app.get("/deleteServiceAnnouncement/:id", async (req, res) => {
  const mydate = new Date();
  const id = req.params.id;
  const { data, error } = await supabase.supabase
    .from("service_announcements")
    .select("*")
    .eq("service_id", id)
    .eq("valid", true);

  res.send(data);
});
app.delete("/deleteAnnouncment/:id", async (req, res) => {
  const mydate = new Date();
  const id = req.params.id;
  const { data, error } = await supabase.supabase
    .from("announcments")
    .delete()
    .match({ id: id });

  const { storagedata, storageerror } = await supabase.supabase.storage
    .from("announcments")
    .remove(id);
  res.send(data);
});
module.exports = app;
