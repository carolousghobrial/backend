const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addPrayer", async (req, res) => {
  prayer = {
    message: req.body.message,
  };

  const { data, error } = await supabase.supabase
    .from("prayerRequests")
    .insert([prayer]);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

app.get("/getPrayers", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("prayerRequests")
    .select("*");
  console.log(data);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.delete("/deletePrayer/:id", async (req, res) => {
  const id = req.params.id;
  console.log(id);
  const { data, error } = await supabase.supabase
    .from("prayerRequests")
    .delete()
    .match({ id: id });

  console.log(data);
  if (error) {
    res.status(500).send(error.message);
  } else {
  }
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
