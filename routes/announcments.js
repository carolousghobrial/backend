const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const { decode } = require("base64-arraybuffer");
const axios = require("axios");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addAnnouncment", async (req, res) => {
  try {
    // Extract announcement data from request body
    const announcement = {
      english_title: req.body.english_title,
      english_description: req.body.english_description,
      arabic_title: req.body.arabic_title,
      arabic_description: req.body.arabic_description,
      url: req.body.url,
      valid: req.body.valid,
    };

    // Extract image from request body
    const image = req.body.image_url;

    // Insert announcement into Supabase
    const { data: announcementData, error: announcementError } = await supabase
      .from("announcements")
      .insert([announcement])
      .select()
      .single();

    if (announcementError) {
      throw new Error(
        "Error inserting announcement into database: " +
          announcementError.message
      );
    }

    const announcementId = announcementData.id;

    // Upload image to Supabase Storage
    const { data: fileData, error: uploadError } = await supabase.storage
      .from("announcements")
      .upload(announcementId, decode(image), {
        contentType: "image/png", // Assuming the image type is PNG
      });

    if (uploadError) {
      throw new Error(
        "Error uploading image to storage: " + uploadError.message
      );
    }

    // Get public URL of the uploaded image
    const fileURLResponse = await supabase.storage
      .from("announcements")
      .getPublicUrl(announcementId);

    if (fileURLResponse.error) {
      throw new Error(
        "Error getting public URL of the uploaded image: " +
          fileURLResponse.error.message
      );
    }

    const fileURL = fileURLResponse.data.publicUrl;

    // Update announcement with image URL
    const { data: updatedData, error: updateError } = await supabase
      .from("announcements")
      .update({ image_url: fileURL })
      .eq("id", announcementId)
      .select()
      .single();

    if (updateError) {
      throw new Error(
        "Error updating announcement with image URL: " + updateError.message
      );
    }

    // Send push notification
    const notificationData = {
      title: updatedData.english_title,
      body: updatedData.english_description,
    };

    const notificationResponse = await axios.post(
      "http://localhost:3000/notifications/sendPushNotification",
      notificationData
    );

    if (notificationResponse.error) {
      throw new Error(
        "Error sending push notification: " + notificationResponse.error.message
      );
    }

    // Return success response
    res.send({ ok: true });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send({ error: error.message });
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
app.get("/", (req, res) => {
  res.send("Hello, Announcment!");
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

  console.log(mydate);
  res.send(data);
});
// app.post("/updateAnnouncment", async (req, res) => {
//   const id = req.body.id;
//   let image_url = "";
//   if (typeof req.body.image_url !== typeof "") {
//     const path = `mainAnnouncments/${id}/image`;
//     const storageRef = ref(firebase.storage, path);

//     await uploadString(storageRef, req.body.image_url.base64String, "base64");
//     image_url = await getDownloadURL(storageRef);
//   } else {
//     image_url = req.body.image_url;
//   }
//   let endDate = null;
//   if (new Date(req.body.endDate) != "Invalid Date") {
//     endDate = firebase.timestamp.fromDate(new Date(req.body.endDate));
//   }
//   updatedAnnouncement = {
//     id: id,
//     english_title: req.body.english_title,
//     english_description: req.body.english_description,
//     arabic_title: req.body.arabic_title,
//     arabic_description: req.body.arabic_description,
//     url: req.body.url,
//     image_url: image_url,
//     publishedDate: firebase.timestamp.fromDate(
//       new Date(req.body.publishedDate)
//     ),
//     endDate: endDate,
//     permanent: req.body.permanent,
//   };
//   updateRedis(updatedAnnouncement);
//   firebase.db
//     .collection("main-announcments")
//     .doc(id)
//     .update(updatedAnnouncement)
//     .then((snapshot) => {
//       res.send(snapshot);
//     });
// });

// app.delete("/deleteAnnouncment/:id", (req, res) => {
//   const id = req.params.id;

//   firebase.db
//     .collection("main-announcments")
//     .doc(id)
//     .delete()
//     .then((snapshot) => {
//       const path = `mainAnnouncments/${id}/image`;
//       const storageRef = ref(firebase.storage, path);
//       deleteObject(storageRef)
//         .then(() => {
//           // File deleted successfully
//           redisClient.del("main-announcments");
//           redisClient.del("valid-main-announcments");

//           res.send(snapshot);
//         })
//         .catch((error) => {
//           // Uh-oh, an error occurred!
//         });
//       //updateRedis()
//     });
// });

// function updateRedis(newitem) {
//   redisClient.del("main-announcments");
//   redisClient.del("valid-main-announcments");

//   // redisClient
//   //   .get("main-announcments")
//   //   .then((data) => {
//   //     if (data) {
//   //       let tempArr = JSON.parse(data);
//   //       tempArr = tempArr.filter((item) => item.id !== newitem.id);
//   //       tempArr.push(newitem);
//   //       redisClient.del("main-announcments");
//   //       redisClient.set("main-announcments", JSON.stringify(tempArr), {
//   //         EX: 60 * 60 * 4,
//   //         NX: true,
//   //       });
//   //       console.log("Success");

//   //       //res.send(data);
//   //     } else {
//   //       console.log("NO DATA");
//   //       throw new Error("Data not found");
//   //     }
//   //   })
//   //   .catch((error) => {
//   //     console.log(`${error.name} : ${error.message}`);
//   //   });
//   // redisClient
//   //   .get("valid-main-announcments")
//   //   .then((data) => {
//   //     if (data) {
//   //       let tempArr = JSON.parse(data);
//   //       tempArr = tempArr.filter((item) => item.id !== newitem.id);
//   //       tempArr.push(newitem);
//   //       redisClient.del("valid-main-announcments");
//   //       redisClient.set("valid-main-announcments", JSON.stringify(tempArr), {
//   //         EX: 60 * 60 * 4,
//   //         NX: true,
//   //       });
//   //       console.log("Success");

//   //       //res.send(data);
//   //     } else {
//   //       console.log("NO DATA");
//   //       throw new Error("Data not found");
//   //     }
//   //   })
//   //   .catch((error) => {
//   //     console.log(`${error.name} : ${error.message}`);
//   //   });
// }
module.exports = app;
