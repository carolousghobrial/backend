const express = require("express");
const app = express();
const port = 3000;
const announcements = require("./routes/announcments");
const users = require("./routes/users");
const calendar = require("./routes/calendar");
const prayerRequests = require("./routes/prayerRequests");
const diptych = require("./routes/diptych");
const notifications = require("./routes/notifications");
const services = require("./routes/services");
const visitations = require("./routes/visitations");
const monthlyBlogArticle = require("./routes/monthlyBlogArticle");
const confessions = require("./routes/confessions");
var bodyParser = require("body-parser");
const axios = require("axios");

// Increase payload size limit (e.g., 10MB)
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));
// parse application/json
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "PUT, POST, GET, DELETE, OPTIONS");
  next();
});
app.use("/announcments", announcements);
app.use("/users", users);
app.use("/calendar", calendar);
app.use("/prayers", prayerRequests);
app.use("/notifications", notifications);
app.use("/services", services);
app.use("/visitations", visitations);
app.use("/confessions", confessions);
app.use("/diptych", diptych);
app.use("/monthlyBlogArticle", monthlyBlogArticle);

app.get("/", (req, res) => {
  res.send("Hello, Express!");
});
app.get("/portalList", async (req, res) => {
  const API_URL = "https://api.suscopts.org/outside/stgeorge_nashville/"; // Replace with your API endpoint
  const USERNAME = "stgeorgenashville";
  const PASSWORD = "st!george|st!mina@stgeorge";
  try {
    //  const response = await axios.get(API_URL);
    const response = await fetch(API_URL, {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString(
          "base64"
        )}`,
        "Content-Type": "application/json",
        // Add any other headers as needed
      },
    });

    // let { data: users, error } = await supabase.from("congregation").select();
    // setsuperbaseData(users);
    if (response.status === 200) {
      const userData = await response.json();
      const updated = userData.filter(
        (user) => user.Email === null || user.Email === ""
      );
      console.log(updated.length);
      res.send(updated);
    } else {
      console.error("Request failed:", response.status, response.data);
    }
  } catch (error) {
    console.error("Error:", error);
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
