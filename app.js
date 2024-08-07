const express = require("express");
const app = express();
const port = process.env.PORT || "3000";
const announcements = require("./routes/announcments");
const users = require("./routes/users");
const calendar = require("./routes/calendar");
const prayerRequests = require("./routes/prayerRequests");
const deaconsSchool = require("./routes/deaconsSchool");
const diptych = require("./routes/diptych");
const notifications = require("./routes/notifications");
const services = require("./routes/services");
const serviceRequests = require("./routes/serviceRequests");
const visitations = require("./routes/visitations");
const monthlyBlogArticle = require("./routes/monthlyBlogArticle");
const confessions = require("./routes/confessions");
const attendance = require("./routes/attendance");
var bodyParser = require("body-parser");

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
app.use("/serviceRequests", serviceRequests);
app.use("/visitations", visitations);
app.use("/confessions", confessions);
app.use("/diptych", diptych);
app.use("/attendance", attendance);
app.use("/monthlyBlogArticle", monthlyBlogArticle);
app.use("/deaconsSchool", deaconsSchool);

app.get("/", (req, res) => {
  res.send("Hello, Express!");
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
