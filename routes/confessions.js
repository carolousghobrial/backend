const express = require("express");
const bp = require("body-parser");
const app = express();
const firebase = require("../config/config");
app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

app.post("/addConfessionRequest", (req, res) => {
  request = {
    uid: req.body.uid,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    cellphone: req.body.cellphone,
    accepted: req.body.accepted,
  };

  let ref = firebase.db.collection("confessionRequests");
  let query = ref
    .where("uid", "==", request.uid)
    .get()
    .then((snapshot) => {
      if (snapshot.empty)
        res.send(
          firebase.db
            .collection("confessionRequests")
            .doc(request.uid)
            .set(request)
        );
      else {
        return res.status(400).send({
          message: "This user already submitted request!",
        });
      }
    });
});

app.post("/acceptConfessionRequest", (req, res) => {
  request = {
    uid: req.body.uid,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    cellphone: req.body.cellphone,
    accepted: true,
  };

  firebase.db
    .collection("confessionRequests")
    .doc(request.uid)
    .update(request)
    .then((snapshot) => {
      res.send(snapshot);
    });
});
app.post("/declineConfessionRequest", (req, res) => {
  request = {
    uid: req.body.uid,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    cellphone: req.body.cellphone,
    accepted: false,
  };

  firebase.db
    .collection("confessionRequests")
    .doc(request.uid)
    .update(request)
    .then((snapshot) => {
      res.send(snapshot);
    });
});
app.get("/getConfessionRequest/:uid", (req, res) => {
  const uid = req.params.uid;
  let ref = firebase.db.collection("confessionRequests");

  let query = ref
    .where("uid", "==", uid)
    .get()
    .then((snapshot) => {
      if (!snapshot.empty) {
        snapshot.forEach((doc) => {
          res.send(doc.data());
        });
      } else {
        return res.status(400).send({
          message: "This user doesn't exist",
        });
      }
    });
});

app.get("/getConfessionRequests", (req, res) => {
  let requests = [];
  firebase.db
    .collection("confessionRequests")
    .get()
    .then((snapshot) => {
      snapshot.docs.forEach((doc) => {
        requests.push(doc.data());
      });

      res.send(requests);
    })
    .catch((error) => {
      // Uh-oh, an error occurred!
    });
});

app.delete("/deleteConfessionRequest/:id", (req, res) => {
  const id = req.params.id;
  firebase.db.collection("confessionRequests").doc(id).delete();
  res.json({ ok: true });
});

app.get("/getFatherAvailableTimes", (req, res) => {
  let requests = [];
  firebase.db
    .collection("availableConfessionTimes")
    .get("standardConfessionTimes")
    .then((snapshot) => {
      snapshot.docs.forEach((doc) => {
        if (Object.keys(doc.data()).length === 0) {
          res.send("HELLO");
        } else {
          requests.push(doc.data());
        }
      });
      res.send(requests);
    })
    .catch((error) => {
      // Uh-oh, an error occurred!
    });
});

app.post("/updateFatherAvailableTimes", (req, res) => {
  updated = {
    appointments: [],
  };
  req.body.forEach((item) => {
    updated.appointments.push(firebase.timestamp.fromDate(new Date(item)));
  }),
    firebase.db
      .collection("availableConfessionTimes")
      .doc("standardConfessionTimes")
      .update(updated)
      .then((snapshot) => {
        res.send(snapshot);
      });
});

app.post("/confirmConfessionRequestWithDate", (req, res) => {
  request = {
    uid: req.body.uid,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    cellphone: req.body.cellphone,
    apointmentDate: firebase.timestamp.fromDate(
      new Date(req.body.apointmentDate)
    ),
  };
  res.send(
    firebase.db
      .collection("acceptedConfessionRequests")
      .doc(request.uid)
      .set(request)
  );
});

app.get("/getConfirmedConfessionRequestByID/:uid", (req, res) => {
  const uid = req.params.uid;
  // let checkExpirationquery = ref
  // .where("apointmentDate", "<", )
  // .get()
  // .then((snapshot) => {
  //   if (!snapshot.empty) {
  //     firebase.db.collection("confessionRequests").doc(id).delete();

  //   } else {
  //     return res.status(400).send({
  //       message: "This user doesn't exist",
  //     });
  //   }
  // });
  firebase.db
    .collection("acceptedConfessionRequests")
    .doc(uid)
    .get()
    .then((snapshot) => {
      if (typeof snapshot.data() !== "undefined") {
        if (
          snapshot.data().apointmentDate <
          firebase.timestamp.fromDate(new Date())
        ) {
          firebase.db
            .collection("acceptedConfessionRequests")
            .doc(uid)
            .delete();
          return res.status(400).send({
            message: "Appointment has passed",
          });
        } else {
          res.send(snapshot.data());
        }
      } else {
        return res.status(400).send({
          message: "This user doesn't exist",
        });
      }
    });
});

app.get("/getConfirmedConfessionRequests", (req, res) => {
  let requests = [];
  firebase.db
    .collection("acceptedConfessionRequests")
    .get()
    .then((snapshot) => {
      snapshot.docs.forEach((doc) => {
        requests.push(doc.data());
      });

      res.send(requests);
    })
    .catch((error) => {
      // Uh-oh, an error occurred!
    });
});
module.exports = app;
