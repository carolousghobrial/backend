const express = require("express");
const app = express();
const { port, nodeEnv, isDevelopment } = require("./config/config");
const axios = require("axios");
const jwt = require("jsonwebtoken");
// Import route modules
const announcements = require("./routes/announcments");
const users = require("./routes/users");
const calendar = require("./routes/calendar");
const prayerRequests = require("./routes/prayerRequests");
const deaconsSchool = require("./routes/deaconsSchool");
const github = require("./routes/github");
const diptych = require("./routes/diptych");
const notifications = require("./routes/notifications");
const services = require("./routes/services");
const serviceRequests = require("./routes/serviceRequests");
const visitations = require("./routes/visitations");
const monthlyBlogArticle = require("./routes/monthlyBlogArticle");
const confessions = require("./routes/confessions");
const attendance = require("./routes/attendance");
const contactUs = require("./routes/contactUs");
const altarResponses = require("./routes/altarResponses");
const stripeWebhook = require("./routes/stripeWebhook");

const bodyParser = require("body-parser");

// ==================== MIDDLEWARE SETUP ====================

// Trust proxy (important for Heroku deployment)
app.set("trust proxy", 1);

// Security headers
app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("X-XSS-Protection", "1; mode=block");
  next();
});

// CORS Configuration for your website
app.use((req, res, next) => {
  const allowedOrigins = [
    // Your production website
    "https://www.stgeorgecocnashville.org",
    "https://stgeorgecocnashville.org",
    "https://stgntbackend-a14a35aa352d.herokuapp.com",
  ];

  const origin = req.headers.origin;

  // In development, allow any localhost port
  const isLocalhost =
    origin &&
    (origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:"));

  if (isDevelopment) {
    console.log("Request origin:", origin);
  }

  // Allow localhost in dev, or whitelisted origins in production
  if (!origin || isLocalhost || allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  } else {
    console.warn("Blocked origin:", origin);
  }

  // Essential headers for authentication
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Access-Token, X-Key",
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  );

  // Allow credentials (important for authentication)
  res.header("Access-Control-Allow-Credentials", "true");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Body parser configuration with increased limits
// Stripe webhook must be mounted before JSON parsing to preserve raw body
app.use("/stripe", stripeWebhook);

app.use(
  bodyParser.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      try {
        JSON.parse(buf);
      } catch (e) {
        res.status(400).json({
          success: false,
          message: "Invalid JSON in request body",
        });
        throw new Error("Invalid JSON");
      }
    },
  }),
);

app.use(
  bodyParser.urlencoded({
    limit: "10mb",
    extended: true,
    parameterLimit: 50000,
  }),
);

// Request logging middleware (useful for debugging)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.path} - IP: ${req.ip}`);

  // Log authentication attempts
  if (req.headers.authorization) {
    console.log(`${timestamp} - Auth header present for ${req.path}`);
  }

  next();
});

// Health check endpoint (should be before routes)
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: nodeEnv,
  });
});

// ==================== ROUTE REGISTRATION ====================

// Mount all route modules
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
app.use("/github", github);
app.use("/contactUs", contactUs);
app.use("/altarResponses", altarResponses);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "St. George Coptic Orthodox Church API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "/health",
      users: "/users",
      announcements: "/announcments",
      calendar: "/calendar",
      prayers: "/prayers",
      notifications: "/notifications",
      services: "/services",
      serviceRequests: "/serviceRequests",
      visitations: "/visitations",
      confessions: "/confessions",
      diptych: "/diptych",
      attendance: "/attendance",
      monthlyBlog: "/monthlyBlogArticle",
      deaconsSchool: "/deaconsSchool",
      github: "/github",
    },
  });
});

// ==================== ERROR HANDLING ====================

// 404 handler for undefined routes
app.use("*", (req, res) => {
  console.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Global error handler:", {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString(),
  });

  res.status(error.status || 500).json({
    success: false,
    message: error.message || "Internal server error",
    timestamp: new Date().toISOString(),
    ...(isDevelopment && {
      error: error.message,
      stack: error.stack,
    }),
  });
});

// ==================== GRACEFUL SHUTDOWN ====================

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down gracefully...");
  process.exit(0);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Handle unhandled promise rejections — log but do NOT crash the server
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// ==================== SERVER STARTUP ====================

const server = app.listen(port, () => {
  console.log(`
🚀 St. George Coptic Orthodox Church API Server Started
📍 Port: ${port}
🌍 Environment: ${nodeEnv}
⏰ Started at: ${new Date().toISOString()}
🔗 Health check: http://localhost:${port}/health
📚 API docs: http://localhost:${port}/
  `);
});

// Keep-alive self-ping to prevent Heroku dyno from sleeping (every 25 minutes)
if (!isDevelopment) {
  const KEEP_ALIVE_URL =
    "https://stgntbackend-a14a35aa352d.herokuapp.com/health";
  setInterval(
    () => {
      axios.get(KEEP_ALIVE_URL).catch((err) => {
        console.warn("Keep-alive ping failed:", err.message);
      });
    },
    25 * 60 * 1000,
  );
  console.log("Keep-alive ping scheduled every 25 minutes.");
}

// Handle server errors
server.on("error", (error) => {
  if (error.syscall !== "listen") {
    throw error;
  }

  const bind = typeof port === "string" ? "Pipe " + port : "Port " + port;

  switch (error.code) {
    case "EACCES":
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case "EADDRINUSE":
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
});

module.exports = app;
