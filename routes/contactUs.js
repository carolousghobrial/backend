const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/addMessage", (req, res) => {
  message = {
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    cellphone: req.body.cellphone,
    email: req.body.email,
    title: req.body.title,
    message: req.body.message,
    publishedDate: req.body.publishedDate,
  };

  res.send(firebase.db.collection("contactus-messages").doc().set(message));
});

app.get("/getMessage/:id", (req, res) => {
  const id = req.params.id;
  firebase.db
    .collection("contactus-messages")
    .doc(id)
    .get()
    .then((snapshot) => {
      res.send(snapshot.data());
    });
});
app.delete("/deleteMessage/:id", (req, res) => {
  const id = req.params.id;
  firebase.db.collection("contactus-messages").doc(id).delete();
  res.json({ ok: true });
});

app.get("/getMessages", (req, res) => {
  let messages = [];
  firebase.db
    .collection("contactus-messages")
    .get()
    .then((snapshot) => {
      snapshot.docs.forEach((doc) => {
        messages.push({
          id: doc.id,
          firstName: doc.data().firstName,
          lastName: doc.data().lastName,
          cellphone: doc.data().cellphone,
          email: doc.data().email,
          title: doc.data().title,
          message: doc.data().message,
          publishedDate: doc.data().publishedDate,
        });
      });
      res.send(messages);
    });
});

app.post("/addprayerRequest", (req, res) => {
  message = {
    title: req.body.title,
    message: req.body.message,
    publishedDate: req.body.publishedDate,
  };

  res.send(
    firebase.db.collection("contactus-prayerRequests").doc().set(message)
  );
});

app.get("/getprayerRequest/:id", (req, res) => {
  const id = req.params.id;
  firebase.db
    .collection("contactus-prayerRequests")
    .doc(id)
    .get()
    .then((snapshot) => {
      res.send(snapshot.data());
    });
});

app.get("/getprayerRequests", (req, res) => {
  let messages = [];
  firebase.db
    .collection("contactus-prayerRequests")
    .get()
    .then((snapshot) => {
      snapshot.docs.forEach((doc) => {
        messages.push({
          id: doc.id,
          title: doc.data().title,
          message: doc.data().message,
          publishedDate: doc.data().publishedDate,
        });
      });
      res.send(messages);
    });
});

app.delete("/deleteprayerRequest/:id", (req, res) => {
  const id = req.params.id;
  firebase.db.collection("contactus-prayerRequests").doc(id).delete();
  res.json({ ok: true });
});

app.post("/addDiptychRequest", (req, res) => {
  message = {
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    dateOfLiturgy: req.body.dateOfLiturgy,
    diptychtype: req.body.diptychtype,
    message: req.body.message,
    publishedDate: req.body.publishedDate,
  };

  res.send(
    firebase.db.collection("contactus-diptychRequests").doc().set(message)
  );
});

app.get("/getDiptychRequest/:id", (req, res) => {
  const id = req.params.id;
  firebase.db
    .collection("contactus-diptychRequests")
    .doc(id)
    .get()
    .then((snapshot) => {
      res.send(snapshot.data());
    });
});

app.get("/getdiptychRequests", (req, res) => {
  let messages = [];
  firebase.db
    .collection("contactus-diptychRequests")
    .get()
    .then((snapshot) => {
      snapshot.docs.forEach((doc) => {
        messages.push({
          id: doc.id,
          firstName: doc.data().firstName,
          lastName: doc.data().lastName,
          dateOfLiturgy: doc.data().dateOfLiturgy,
          diptychtype: doc.data().diptychtype,
          message: doc.data().message,
          publishedDate: doc.data().publishedDate,
        });
      });
      res.send(messages);
    });
});

app.delete("/deletediptychRequest/:id", (req, res) => {
  const id = req.params.id;
  firebase.db.collection("contactus-diptychRequests").doc(id).delete();
  res.json({ ok: true });
});

module.exports = app;
