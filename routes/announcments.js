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

// Helper function to send push notifications
const sendAnnouncementNotification = async (title, body, isEdit = false) => {
  try {
    const notificationEndpoint =
      "https://stgntbackend-a14a35aa352d.herokuapp.com/notifications/sendPushNotification";

    const requestBody = {
      title: isEdit ? `Updated: ${title}` : title,
      body: body,
      data: {
        type: "announcement",
        action: isEdit ? "updated" : "new",
        timestamp: new Date().toISOString(),
      },
    };

    console.log(
      `Sending ${isEdit ? "update" : "new"} announcement notification:`,
      requestBody
    );

    const response = await axios.post(notificationEndpoint, requestBody, {
      timeout: 10000, // 10 second timeout
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log("Notification sent successfully:", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("Failed to send notification:", error.message);
    // Don't fail the main operation if notification fails
    return { success: false, error: error.message };
  }
};

app.post("/addAnnouncment", async (req, res) => {
  try {
    // Extract announcement data from request body
    const {
      english_title,
      english_description,
      arabic_title,
      arabic_description,
      url,
      valid = true, // Default to true if not specified
      image_url,
    } = req.body;

    // Validate required fields
    if (!english_title || !english_description) {
      return res.status(400).send({
        error: "English title and description are required",
      });
    }

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
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Database insert error:", error);
      throw new Error("Error inserting announcement into database");
    }

    let finalImageUrl = null;

    // Handle image upload if provided
    if (image_url) {
      try {
        // Upload image to Supabase Storage
        const { data: fileData, error: uploadError } =
          await supabase.supabase.storage
            .from("announcments")
            .upload(data.id.toString(), decode(image_url), {
              contentType: "image/png",
              upsert: true, // Allow overwriting if file exists
            });

        if (uploadError) {
          console.error("Image upload error:", uploadError);
          throw new Error("Error uploading image to storage");
        }

        // Get public URL of the uploaded image
        const { data: publicUrlData } = await supabase.supabase.storage
          .from("announcments")
          .getPublicUrl(data.id.toString());

        finalImageUrl = publicUrlData.publicUrl;

        // Update announcement with image URL in database
        const { error: updateError } = await supabase.supabase
          .from("announcments")
          .update({ image_url: finalImageUrl })
          .eq("id", data.id);

        if (updateError) {
          console.error("Image URL update error:", updateError);
          throw new Error("Error updating image URL in database");
        }
      } catch (imageError) {
        console.error("Image processing failed:", imageError);
        // Continue without image rather than failing the entire operation
        console.log("Continuing without image due to upload failure");
      }
    }

    // Send push notification for new announcements (only if valid)
    if (valid) {
      const notificationResult = await sendAnnouncementNotification(
        english_title,
        english_description,
        false // isEdit = false for new announcements
      );

      if (!notificationResult.success) {
        console.warn(
          "Notification failed but announcement was created successfully"
        );
      }
    }

    res.send({
      ok: true,
      data: {
        ...data,
        image_url: finalImageUrl,
      },
      message: "Announcement created successfully",
    });
  } catch (error) {
    console.error("Error in addAnnouncment:", error.message);
    res.status(500).send({
      error: "An error occurred while processing the request",
      details: error.message,
    });
  }
});

app.post("/editAnnouncment/:id", async (req, res) => {
  try {
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

    // Validate ID
    if (!id) {
      return res.status(400).send({ error: "Announcement ID is required" });
    }

    // Update announcement in database
    const { data, error } = await supabase.supabase
      .from("announcments")
      .update({
        english_title,
        english_description,
        arabic_title,
        arabic_description,
        url,
        valid,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Database update error:", error);
      throw new Error("Error updating announcement in database");
    }

    if (!data) {
      return res.status(404).send({ error: "Announcement not found" });
    }

    let finalImageUrl = data.image_url; // Keep existing image URL as default

    // Handle image update if provided
    if (image_url) {
      try {
        // Upload/update image to Supabase Storage
        const { data: fileData, error: uploadError } =
          await supabase.supabase.storage
            .from("announcments")
            .upload(id, decode(image_url), {
              contentType: "image/png",
              upsert: true, // This will overwrite existing file
            });

        if (uploadError) {
          console.error("Image upload error:", uploadError);
          throw new Error("Error uploading image to storage");
        }

        // Get public URL of the uploaded image
        const { data: publicUrlData } = await supabase.supabase.storage
          .from("announcments")
          .getPublicUrl(id);

        finalImageUrl = publicUrlData.publicUrl;

        // Update announcement with new image URL
        const { error: updateImageError } = await supabase.supabase
          .from("announcments")
          .update({ image_url: finalImageUrl })
          .eq("id", id);

        if (updateImageError) {
          console.error("Image URL update error:", updateImageError);
          throw new Error("Error updating image URL in database");
        }
      } catch (imageError) {
        console.error("Image processing failed:", imageError);
        // Continue without updating image rather than failing the entire operation
        console.log("Continuing with existing image due to upload failure");
      }
    }

    // Send push notification for announcement updates (only if valid)
    if (valid) {
      const notificationResult = await sendAnnouncementNotification(
        english_title || data.english_title,
        english_description || data.english_description,
        true // isEdit = true for updates
      );

      if (!notificationResult.success) {
        console.warn(
          "Notification failed but announcement was updated successfully"
        );
      }
    }

    res.send({
      ok: true,
      data: {
        ...data,
        image_url: finalImageUrl,
      },
      message: "Announcement updated successfully",
    });
  } catch (error) {
    console.error("Error in editAnnouncment:", error.message);
    res.status(500).send({
      error: "An error occurred while processing the request",
      details: error.message,
    });
  }
});

app.get("/getAnnouncment/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!id) {
      return res.status(400).send({ error: "Announcement ID is required" });
    }

    const { data, error } = await supabase.supabase
      .from("announcments")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error fetching announcement:", error);
      return res.status(404).send({ error: "Announcement not found" });
    }

    res.send(data);
  } catch (error) {
    console.error("Error in getAnnouncment:", error.message);
    res
      .status(500)
      .send({ error: "An error occurred while fetching the announcement" });
  }
});

app.get("/getAnnouncments", async (req, res) => {
  try {
    const { data: mainAnnouncments, error } = await supabase.supabase
      .from("announcments")
      .select("*")
      .order("created_at", { ascending: false }); // Order by newest first

    if (error) {
      console.error("Error fetching announcements:", error);
      throw new Error("Error fetching announcements");
    }

    res.send(mainAnnouncments || []);
  } catch (error) {
    console.error("Error in getAnnouncments:", error.message);
    res
      .status(500)
      .send({ error: "An error occurred while fetching announcements" });
  }
});

app.get("/getValidAnnouncments", async (req, res) => {
  try {
    const { data, error } = await supabase.supabase
      .from("announcments")
      .select("*")
      .eq("valid", true)
      .order("created_at", { ascending: false }); // Order by newest first

    if (error) {
      console.error("Error fetching valid announcements:", error);
      throw new Error("Error fetching valid announcements");
    }

    console.log(`Found ${data?.length || 0} valid announcements`);
    res.send(data || []);
  } catch (error) {
    console.error("Error in getValidAnnouncments:", error.message);
    res
      .status(500)
      .send({ error: "An error occurred while fetching valid announcements" });
  }
});

app.post("/toggleValid", async (req, res) => {
  try {
    const { id, newStatus, tableName = "announcments" } = req.body;

    if (!id || typeof newStatus !== "boolean") {
      return res.status(400).send({
        error: "ID and newStatus (boolean) are required",
      });
    }

    console.log(`Toggling ${tableName} ID ${id} to ${newStatus}`);

    const { data, error } = await supabase.supabase
      .from(tableName)
      .update({
        valid: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Toggle valid error:", error);
      return res.status(500).send({ error: error.message });
    }

    if (!data) {
      return res.status(404).send({ error: "Record not found" });
    }

    console.log("Toggle successful:", data);
    res.send(data);
  } catch (error) {
    console.error("Error in toggleValid:", error.message);
    res.status(500).send({ error: "An error occurred while toggling status" });
  }
});

app.get("/getValidServiceAnnouncments/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!id) {
      return res.status(400).send({ error: "Service ID is required" });
    }

    console.log("Fetching valid service announcements for service:", id);

    const { data, error } = await supabase.supabase
      .from("service_announcements")
      .select("*")
      .eq("service_id", id)
      .eq("valid", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching service announcements:", error);
      throw new Error("Error fetching service announcements");
    }

    res.send(data || []);
  } catch (error) {
    console.error("Error in getValidServiceAnnouncments:", error.message);
    res.status(500).send({
      error: "An error occurred while fetching service announcements",
    });
  }
});

app.post("/addServiceAnnouncment", async (req, res) => {
  try {
    const { service_id, message, url, valid = true, image_url } = req.body;

    // Validate required fields
    if (!service_id || !message) {
      return res.status(400).send({
        error: "Service ID and message are required",
      });
    }

    const announcement = {
      service_id,
      message,
      url,
      valid,
      created_at: new Date().toISOString(),
    };

    console.log("Adding service announcement:", announcement);

    // Insert service announcement into database
    const { data, error } = await supabase.supabase
      .from("service_announcements")
      .insert([announcement])
      .select()
      .single();

    if (error) {
      console.error("Service announcement insert error:", error);
      throw new Error("Error inserting service announcement into database");
    }

    let finalImageUrl = null;

    // Handle image upload if provided
    if (image_url) {
      try {
        const { data: fileData, error: uploadError } =
          await supabase.supabase.storage
            .from("service_announcements")
            .upload(data.id.toString(), decode(image_url), {
              contentType: "image/png",
              upsert: true,
            });

        if (uploadError) {
          console.error(
            "Service announcement image upload error:",
            uploadError
          );
          throw new Error("Error uploading image to storage");
        }

        // Get public URL of the uploaded image
        const { data: publicUrlData } = await supabase.supabase.storage
          .from("service_announcements")
          .getPublicUrl(data.id.toString());

        finalImageUrl = publicUrlData.publicUrl;

        // Update service announcement with image URL
        const { error: updateError } = await supabase.supabase
          .from("service_announcements")
          .update({ image_url: finalImageUrl })
          .eq("id", data.id);

        if (updateError) {
          console.error(
            "Service announcement image URL update error:",
            updateError
          );
          throw new Error("Error updating image URL in database");
        }
      } catch (imageError) {
        console.error(
          "Service announcement image processing failed:",
          imageError
        );
        console.log("Continuing without image due to upload failure");
      }
    }

    // Send service-specific push notification (only if valid)
    if (valid) {
      try {
        const serviceNotificationEndpoint = process.env.NOTIFICATION_ENDPOINT
          ? `${process.env.NOTIFICATION_ENDPOINT.replace(
              "/sendPushNotification",
              ""
            )}/sendSubscribedServicePushNotification/${service_id}`
          : `http://localhost:3000/notifications/sendSubscribedServicePushNotification/${service_id}`;

        const requestBody = {
          title: `Service Update`, // You might want to make this more descriptive
          body: message,
          data: {
            type: "service_announcement",
            service_id: service_id,
            timestamp: new Date().toISOString(),
          },
        };

        console.log("Sending service-specific notification:", requestBody);

        const response = await axios.post(
          serviceNotificationEndpoint,
          requestBody,
          {
            timeout: 10000,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        console.log("Service notification sent successfully:", response.data);
      } catch (notificationError) {
        console.error(
          "Failed to send service notification:",
          notificationError.message
        );
        // Don't fail the main operation if notification fails
      }
    }

    res.send({
      ok: true,
      data: {
        ...data,
        image_url: finalImageUrl,
      },
      message: "Service announcement created successfully",
    });
  } catch (error) {
    console.error("Error in addServiceAnnouncment:", error.message);
    res.status(500).send({
      error: "An error occurred while processing the request",
      details: error.message,
    });
  }
});

app.get("/getServiceAnnouncments/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!id) {
      return res.status(400).send({ error: "Service ID is required" });
    }

    const { data, error } = await supabase.supabase
      .from("service_announcements")
      .select("*")
      .eq("service_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching service announcements:", error);
      throw new Error("Error fetching service announcements");
    }

    res.send(data || []);
  } catch (error) {
    console.error("Error in getServiceAnnouncments:", error.message);
    res.status(500).send({
      error: "An error occurred while fetching service announcements",
    });
  }
});

app.delete("/deleteAnnouncment/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!id) {
      return res.status(400).send({ error: "Announcement ID is required" });
    }

    // Delete from database
    const { data, error } = await supabase.supabase
      .from("announcments")
      .delete()
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Error deleting announcement:", error);
      throw new Error("Error deleting announcement");
    }

    // Try to delete associated image from storage (don't fail if it doesn't exist)
    try {
      const { data: storageData, error: storageError } =
        await supabase.supabase.storage.from("announcments").remove([id]);

      if (storageError) {
        console.warn("Could not delete image from storage:", storageError);
      }
    } catch (storageError) {
      console.warn("Storage cleanup failed:", storageError);
    }

    res.send({
      ok: true,
      data,
      message: "Announcement deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteAnnouncment:", error.message);
    res
      .status(500)
      .send({ error: "An error occurred while deleting the announcement" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.send({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "announcements-service",
  });
});

module.exports = app;
