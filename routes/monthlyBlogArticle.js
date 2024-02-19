const express = require("express");
const bp = require("body-parser");
const app = express();
const firebase = require("../config/config");
const {
  ref,
  uploadString,
  getDownloadURL,
  deleteObject,
} = require("firebase/storage");
app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addMonthlyBlogArticle", async (req, res) => {
  request = {
    english_title: req.body.english_title,
    EnglishAuthor: req.body.EnglishAuthor,
    EnglishShortArticle: req.body.EnglishShortArticle,
    EnglishFullArticle: req.body.EnglishFullArticle,
    arabic_title: req.body.arabic_title,
    ArabicAuthor: req.body.ArabicAuthor,
    ArabicShortArticle: req.body.ArabicShortArticle,
    ArabicFullArticle: req.body.ArabicFullArticle,
    image_url: req.body.image_url,
    viewMonth: req.body.viewMonth,
  };

  const id = firebase.db.collection("MonthlyBlogArticles").doc().id;

  const path = `MonthlyBlogArticles/${id}/image`;
  const storageRef = ref(firebase.storage, path);

  await uploadString(storageRef, request.image_url.base64String, "base64");
  const image_url = await getDownloadURL(storageRef);
  res.send(
    firebase.db.collection("MonthlyBlogArticles").doc(id).set({
      id: id,
      english_title: request.english_title,
      EnglishAuthor: request.EnglishAuthor,
      EnglishShortArticle: request.EnglishShortArticle,
      EnglishFullArticle: request.EnglishFullArticle,
      arabic_title: request.arabic_title,
      ArabicAuthor: request.ArabicAuthor,
      ArabicShortArticle: request.ArabicShortArticle,
      ArabicFullArticle: request.ArabicFullArticle,
      image_url: image_url,
      viewMonth: request.viewMonth,
    })
  );
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

app.get("/getValidMonthlyBlogArticle", async (req, res) => {
  const usersRef = firebase.db.collection("MonthlyBlogArticles");
  const snapshot = await usersRef
    .where("viewMonth", "==", new Date().getMonth())
    .limit(1)
    .get();

  if (snapshot.empty) {
    return;
  }
  snapshot.forEach((doc) => {
    res.send(doc.data());
  });
});
app.get("/getMonthlyBlogArticles", (req, res) => {
  let blogs = [];
  firebase.db
    .collection("MonthlyBlogArticles")
    .get()
    .then((snapshot) => {
      snapshot.docs.forEach((doc) => {
        blogs.push(doc.data());
      });

      res.send(blogs);
    });
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
