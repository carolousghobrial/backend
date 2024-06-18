const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addMonthlyBlogArticle", async (req, res) => {
  const blog = {
    english_title: req.body.english_title,
    english_author: req.body.english_author,
    english_article: req.body.english_article,
    arabic_title: req.body.arabic_title,
    arabic_author: req.body.arabic_author,
    arabic_article: req.body.arabic_article,
    view_month: req.body.view_month,
  };
  const image = req.body.image_url;
  try {
    // Insert announcement into database
    const { data, error } = await supabase.supabase
      .from("announcments")
      .insert([blog])
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
      console.log(uploadError);
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

    if (updatedError) {
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
app.post("/updateMonthlyBlogArticle", async (req, res) => {
  const id = req.body.id;
  let image_url = "";
  if (typeof req.body.image_url !== typeof "") {
    const path = `MonthlyBlogArticles/${id}/image`;
    const storageRef = ref(firebase.storage, path);

    await uploadString(storageRef, req.body.image_url.base64String, "base64");
    image_url = await getDownloadURL(storageRef);
  } else {
    image_url = req.body.image_url;
  }

  updatedBlog = {
    id: id,
    english_title: req.body.english_title,
    EnglishAuthor: req.body.EnglishAuthor,
    EnglishShortArticle: req.body.EnglishShortArticle,
    EnglishFullArticle: req.body.EnglishFullArticle,
    arabic_title: req.body.arabic_title,
    ArabicAuthor: req.body.ArabicAuthor,
    ArabicShortArticle: req.body.ArabicShortArticle,
    ArabicFullArticle: req.body.ArabicFullArticle,
    image_url: image_url,
    viewMonth: req.body.viewMonth,
  };
  firebase.db
    .collection("MonthlyBlogArticles")
    .doc(id)
    .update(updatedBlog)
    .then((snapshot) => {
      res.send(snapshot);
    });
});

app.get("/getMonthlyBlogArticle/:id", (req, res) => {
  const id = req.params.id;
  firebase.db
    .collection("MonthlyBlogArticles")
    .doc(id)
    .get()
    .then((snapshot) => {
      res.send(snapshot.data());
    });
});

app.get("/getCurrentdMonthlyBlogArticle", async (req, res) => {
  const cur_month = new Date().getMonth();
  const { data, error } = await supabase.supabase
    .from("monthly_blog_article")
    .select("*")
    .eq("view_month", cur_month)
    .single();

  res.send(data);
});
app.get("/getMonthlyBlogArticles", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("monthly_blog_article")
    .select("*");
  res.send(data);
});

app.delete("/deleteMonthlyBlogArticle/:id", (req, res) => {
  const id = req.params.id;

  firebase.db
    .collection("MonthlyBlogArticles")
    .doc(id)
    .delete()
    .then((snapshot) => {
      const path = `MonthlyBlogArticles/${id}/image`;
      const storageRef = ref(firebase.storage, path);
      deleteObject(storageRef)
        .then(() => {
          // File deleted successfully
          res.send(snapshot);
        })
        .catch((error) => {
          // Uh-oh, an error occurred!
        });
      //updateRedis()
    });
});

module.exports = app;
