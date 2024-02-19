const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const supabase = require("../config/config");
// Parse application/json
app.use(bodyParser.json());

// Parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", async (req, res) => {
  res.send("HERE");
});

app.post("/logout", async (req, res) => {
  const { error } = await supabase.supabase.auth.signOut();
  res.json({ ok: true });
});

app.post("/login", async (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  const { data, error } = await supabase.supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });
  if (error != null) {
    console.log(error);
    res.send(error.status);
  } else {
    let { data: profiles, error } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .single();
    console.log(profiles);

    res.send({
      token: data.session.access_token,
      user: profiles,
    });
  }
});
app.post("/register", async (req, res) => {
  newUser = {
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    dob: new Date(req.body.dob),
    cellphone: req.body.cellphone,
    email: req.body.email,
    portal_id: req.body.portal_id,
    password: req.body.password,
    family_id: req.body.family_id,
  };
  console.log(newUser);
  const { data, error } = await supabase.supabase.auth.signUp({
    email: newUser.email,
    password: newUser.password,
    options: {
      data: {
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        dob: newUser.dob,
        cellphone: newUser.cellphone,
        email: newUser.email,
        portal_id: newUser.portal_id,
        family_id: newUser.family_id,
      },
    },
  });
  if (error) {
    console.log(error);
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

app.post("/forgotPassword", (req, res) => {
  const email = req.body.email;
});

app.get("/getCurrentUser/:uid", async (req, res) => {
  const jwt = req.params.uid;

  const {
    data: { user },
  } = await supabase.supabase.auth.getUser(jwt);
  if (user == null) {
    res.send(null);
  }
  res.send(user.user_metadata);
});
app.get("/getLoggedIn", async (req, res) => {
  const {
    data: { session },
  } = await supabase.supabase.auth.getSession();

  console.log(session);
  res.send(session);
});
// app.get("/getUser/:id", (req, res) => {
//   const id = req.params.id;
//   firebase.db
//     .collection("users")
//     .doc(id)
//     .get()
//     .then((snapshot) => {
//       res.send(snapshot.data());
//     });
// });
// app.post("/updateUser", async (req, res) => {
//   const id = req.body.uid;
//   let image_url = "";
//   if (req.body.profileImg == null) {
//     image_url = null;
//   } else if (typeof req.body.profileImg !== typeof "") {
//     console.log("here");
//     const path = `users/${id}/profileImg`;
//     const storageRef = ref(firebase.storage, path);
//     await uploadString(storageRef, req.body.profileImg.base64String, "base64");
//     image_url = await getDownloadURL(storageRef);
//   } else {
//     image_url = req.body.profileImg;
//   }

//   updatedUser = {
//     uid: req.body.uid,
//     familyID: req.body.familyID,
//     first_name: req.body.first_name,
//     middleName: req.body.middleName,
//     last_name: req.body.last_name,
//     cellphone: req.body.cellphone,
//     email: req.body.email,
//     streetNum: req.body.streetNum,
//     streetName: req.body.streetName,
//     city: req.body.city,
//     state: req.body.state,
//     zipcode: req.body.zipcode,
//     country: req.body.country,
//     fullAddress: req.body.fullAddress,
//     gender: req.body.gender,
//     maritalStatus: req.body.maritalStatus,
//     weddingAnniversary: firebase.timestamp.fromDate(
//       new Date(req.body.weddingAnniversary)
//     ),
//     profileImg: image_url,
//     birthday: firebase.timestamp.fromDate(new Date(req.body.birthday)),
//     servicesIn: req.body.servicesIn,
//     servicesInID: req.body.servicesInID,
//   };
//   updatedUser.servicesInID.forEach((element) => {
//     keyName = `users-${element}`;
//     redisClient.del(keyName);
//     redisClient.del("currentUser");
//   });
//   firebase.db
//     .collection("users")
//     .doc(id)
//     .update(updatedUser)
//     .then((snapshot) => {
//       res.send(snapshot);
//     });
// });
app.get("/getUsers", async (req, res) => {
  const { data, error } = await supabase.supabase.from("profiles").select("*");
  console.log(error);
  console.log(data);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
// app.get("/getUsersByService/:service", checkCache, async (req, res) => {
//   this.service = req.params.service;
//   let users = [];
//   const usersRef = firebase.db.collection("users");
//   const snapshot = await usersRef
//     .where("servicesInID", "array-contains", service)
//     .get();
//   if (snapshot.empty) {
//     return;
//   }
//   snapshot.forEach((doc) => {
//     users.push(doc.data());
//   });
//   await redisClient.set(`users-${service}`, JSON.stringify(users), {
//     EX: 60 * 60 * 4,
//     NX: true,
//   });

//   res.send(users);
// });
// app.delete("/deleteUser/:uid", (req, res) => {
//   const id = req.params.uid;
//   firebase.db
//     .collection("users")
//     .doc(id)
//     .delete()
//     .then((snapshot) => {
//       const path = `users/${id}/profileImg`;
//       const storageRef = ref(firebase.storage, path);
//       deleteObject(storageRef)
//         .then(() => {
//           // File deleted successfully
//           res.send(snapshot);
//         })
//         .catch((error) => {
//           // Uh-oh, an error occurred!
//         });
//     });
// });

module.exports = app;
