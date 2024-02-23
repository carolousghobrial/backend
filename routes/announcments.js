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
  Announcment = {
    english_title: req.body.english_title,
    english_description: req.body.english_description,
    arabic_title: req.body.arabic_title,
    arabic_description: req.body.arabic_description,
    url: req.body.url,
    valid: req.body.valid,
  };
  const Image = req.body.image_url;
  console.log(Image);

  try {
    const { data, error } = await supabase.supabase
      .from("announcments")
      .insert([Announcment])
      .select()
      .single();
    //console.log(data);
    const myId = data.id;

    // Upload file to Superbase Storage
    const { data: fileData, error: uploadError } =
      await supabase.supabase.storage
        .from("announcments")
        .upload(myId, decode(Image), {
          contentType: "image/png",
        });

    if (uploadError) {
      console.error("Error uploading file:", uploadError.message);
      return;
    }

    // // // Get the URL of the uploaded file
    const fileURL = supabase.supabase.storage
      .from("announcments")
      .getPublicUrl(myId);
    const newAnnouncement = Announcment;

    const newFileURL = fileURL.data.publicUrl;
    //console.log(newFileURL);
    newAnnouncement.image_url = newFileURL;
    // console.log(newAnnouncement);
    // // Save file URL to database
    const { data: updatedData, error: updatedError } = await supabase.supabase
      .from("announcments")
      .update({ image_url: newFileURL })
      .eq("id", myId)
      .select()
      .single();

    if (updatedError) {
      console.error("Error saving file URL to database:", updatedError.message);
      return;
    } else {
      const requestBody = {
        title: updatedData.english_title,
        body: updatedData.english_description,
      };

      // Call another endpoint (API) with a request body using Axios
      const response = await axios.post(
        "http://localhost:3000/notifications/sendPushNotification",
        requestBody
      );
      res.send({ ok: true });
    }
  } catch (error) {
    console.error("Error:", error.message);
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

app.delete("/deleteAnnouncment/:index", async (req, res) => {
  const id = req.params.index;

  const { data: updatedData, error: updateError } = await supabase.supabase
    .from("announcments")
    .delete()
    .match({ id: id });
  if (updateError) {
    res.status(500).send(updateError.message);
  } else {
    const { data, error } = await supabase.supabase.storage
      .from("announcments")
      .remove(id);
    if (error) {
      console.log(error);
      res.status(500);
    } else {
      res.send(data);
    }
  }
});

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
