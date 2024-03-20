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
    family_role: req.body.family_role,
  };
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
        family_role: newUser.family_role,
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
app.post("/registerwithoutemail", async (req, res) => {
  newUser = {
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    dob: new Date(req.body.dob),
    cellphone: req.body.cellphone,
    email: req.body.email,
    portal_id: req.body.portal_id,
    family_id: req.body.family_id,
    family_role: req.body.family_role,
  };
  const { data, error } = await supabase.supabase
    .from("profiles")
    .insert([newUser]);
  if (error) {
    console.log(error);
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.post("/updateUser/:portal_id", async (req, res) => {
  const portal_id = req.params.portal_id;
  newUser = {
    first_name: req.body.first_name,
    last_name: req.body.last_name,
    dob: new Date(req.body.dob),
    cellphone: req.body.cellphone,
    email: req.body.email,
    portal_id: req.body.portal_id,
    family_id: req.body.family_id,
    family_role: req.body.family_role,
  };
  console.log(newUser);
  const { data: updatedData, error: updateError } = await supabase.supabase
    .from("profiles")
    .update({ family_role: newUser.family_role.toUpperCase() })
    .eq("portal_id", portal_id);
  if (updateError) {
    console.log(updateError);
    res.status(500).send(updateError.message);
  } else {
    res.send(updatedData);
  }
});
app.post("/forgotPassword", (req, res) => {
  const email = req.body.email;
});

app.get("/getCurrentUser/:uid", async (req, res) => {
  const jwt = req.params.uid;
  try {
    const {
      data: { user },
    } = await supabase.supabase.auth.getUser(jwt);
    if (user == null) {
      res.status(500);
    } else {
      res.send(user.user_metadata);
    }
  } catch (error) {
    console.log(error);
    res.status(500);
  }
});
app.get("/getLoggedIn", async (req, res) => {
  const {
    data: { session },
  } = await supabase.supabase.auth.getSession();

  res.send(session);
});
app.get("/getUserById/:id", async (req, res) => {
  const id = req.params.id;
  const { data: profiles, error } = await supabase.supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(profiles);
  }
});
app.get("/getFamilyUsersForHead/:familyId", async (req, res) => {
  const family_id = req.params.familyId;
  const { data: profiles, error } = await supabase.supabase
    .from("profiles")
    .select("*")
    .eq("family_id", family_id);

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(profiles);
  }
});
app.get("/getRolesAndServiceOfUser/:userId", async (req, res) => {
  const userId = req.params.userId;

  let { data: user_service_roles, error } = await supabase.supabase
    .from("user_service_roles")
    .select("role_id,service_id")
    .eq("user_id", userId);

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(user_service_roles);
  }
});

app.get("/getUsers", async (req, res) => {
  const { data, error } = await supabase.supabase.from("profiles").select("*");

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});

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
