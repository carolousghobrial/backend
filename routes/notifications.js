const { Expo } = require("expo-server-sdk");
const express = require("express");
const bodyParser = require("body-parser");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");
const { body, param, validationResult } = require("express-validator");

const app = express();
const expo = new Expo({
  accessToken:
    process.env.EXPO_ACCESS_TOKEN || "wRoom62gGBmplz16uA9Irz34uZeVvrBpvEcQT9Dk",
  useFcmV1: true, // Use FCM v1 API for better reliability
});

const supabase = require("../config/config");

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || [
      "http://localhost:3000",
    ],
    credentials: true,
  })
);

// Rate limiting
const notificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 notification requests per windowMs
  message: { error: "Too many notification requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Limit token registrations
  message: { error: "Too many registration attempts, please try again later." },
});

// Body parsing middleware
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }
  next();
};

// Utility functions
const isValidExpoPushToken = (token) => {
  return Expo.isExpoPushToken(token);
};

const createSuccessResponse = (data, message = "Success") => ({
  success: true,
  message,
  data,
});

const createErrorResponse = (message, error = null) => ({
  success: false,
  message,
  error: error && process.env.NODE_ENV === "development" ? error : undefined,
});

// Database functions with error handling
const getUserByToken = async (token) => {
  try {
    const { data, error } = await supabase.supabase
      .from("user_tokens")
      .select("*")
      .eq("token", token)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error fetching user by token:", error);
    throw new Error("Failed to fetch user data");
  }
};

const getGeneralNotificationsToken = async () => {
  try {
    const { data, error } = await supabase.supabase
      .from("user_tokens")
      .select("token, userId")
      .eq("generalNotificationsAllowed", true);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching notification tokens:", error);
    throw new Error("Failed to fetch notification tokens");
  }
};

const getSubscribedServiceNotificationsToken = async (service_id) => {
  try {
    const { data, error } = await supabase.supabase
      .from("user_tokens")
      .select("token, userId")
      .contains("service_subscribed", [service_id]);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching service notification tokens:", error);
    throw new Error("Failed to fetch service notification tokens");
  }
};

const createOrUpdateUserToken = async (tokenData) => {
  try {
    const { data, error } = await supabase.supabase
      .from("user_tokens")
      .upsert(tokenData, {
        onConflict: "token",
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error creating/updating user token:", error);
    throw new Error("Failed to save token data");
  }
};

// Routes with validation and error handling

// Register/Update push token
app.post(
  "/registerToken",
  registrationLimiter,
  [
    body("token").notEmpty().withMessage("Token is required"),
    body("userId").notEmpty().withMessage("User ID is required"),
    body("generalNotificationsAllowed")
      .isBoolean()
      .withMessage("Notification preference must be boolean"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token, generalNotificationsAllowed, userId } = req.body;

      // Validate Expo push token format
      if (!isValidExpoPushToken(token)) {
        return res
          .status(400)
          .json(createErrorResponse("Invalid push token format"));
      }

      const tokenData = {
        token,
        generalNotificationsAllowed,
        userId,
        updatedAt: new Date().toISOString(),
        deviceInfo: {
          userAgent: req.get("User-Agent"),
          ip: req.ip,
        },
      };

      const result = await createOrUpdateUserToken(tokenData);

      res.json(createSuccessResponse(result, "Token registered successfully"));
    } catch (error) {
      console.error("Token registration error:", error);
      res
        .status(500)
        .json(createErrorResponse("Failed to register token", error.message));
    }
  }
);

// Send general push notifications
app.post(
  "/sendPushNotification",
  notificationLimiter,
  [
    body("title").notEmpty().withMessage("Title is required"),
    body("body").notEmpty().withMessage("Body is required"),
    body("data").optional().isObject(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { title, body, data = {} } = req.body;
      const tokens = await getGeneralNotificationsToken();

      if (tokens.length === 0) {
        return res.json(
          createSuccessResponse(
            { sent: 0, failed: 0 },
            "No tokens found for general notifications"
          )
        );
      }

      // Filter valid tokens
      const validTokens = tokens.filter((tokenData) =>
        isValidExpoPushToken(tokenData.token)
      );

      const notifications = validTokens.map((tokenData) => ({
        to: tokenData.token,
        sound: "default",
        title,
        body,
        data: {
          ...data,
          timestamp: new Date().toISOString(),
          type: "general",
        },
        priority: "high",
        channelId: "default",
      }));

      // Send in chunks to avoid rate limits
      const chunks = expo.chunkPushNotifications(notifications);
      const results = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          results.push(...ticketChunk);
        } catch (error) {
          console.error("Error sending notification chunk:", error);
          results.push(
            ...chunk.map(() => ({ status: "error", message: error.message }))
          );
        }
      }

      const successful = results.filter(
        (ticket) => ticket.status === "ok"
      ).length;
      const failed = results.length - successful;

      res.json(
        createSuccessResponse(
          { sent: successful, failed, total: tokens.length },
          `Notifications sent: ${successful} successful, ${failed} failed`
        )
      );
    } catch (error) {
      console.error("Send notification error:", error);
      res
        .status(500)
        .json(
          createErrorResponse("Failed to send notifications", error.message)
        );
    }
  }
);

// Send service-specific notifications
app.post(
  "/sendSubscribedServicePushNotification/:service_id",
  notificationLimiter,
  [
    param("service_id").notEmpty().withMessage("Service ID is required"),
    body("title").notEmpty().withMessage("Title is required"),
    body("body").notEmpty().withMessage("Body is required"),
    body("data").optional().isObject(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { service_id } = req.params;
      const { title, body, data = {} } = req.body;

      const tokens = await getSubscribedServiceNotificationsToken(service_id);

      if (tokens.length === 0) {
        return res.json(
          createSuccessResponse(
            { sent: 0, failed: 0 },
            `No subscribers found for service: ${service_id}`
          )
        );
      }

      const validTokens = tokens.filter((tokenData) =>
        isValidExpoPushToken(tokenData.token)
      );

      const notifications = validTokens.map((tokenData) => ({
        to: tokenData.token,
        sound: "default",
        title,
        body,
        data: {
          ...data,
          service_id,
          timestamp: new Date().toISOString(),
          type: "service",
        },
        priority: "high",
        channelId: "service_notifications",
      }));

      const chunks = expo.chunkPushNotifications(notifications);
      const results = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          results.push(...ticketChunk);
        } catch (error) {
          console.error("Error sending service notification chunk:", error);
          results.push(
            ...chunk.map(() => ({ status: "error", message: error.message }))
          );
        }
      }

      const successful = results.filter(
        (ticket) => ticket.status === "ok"
      ).length;
      const failed = results.length - successful;

      res.json(
        createSuccessResponse(
          { sent: successful, failed, total: tokens.length, service_id },
          `Service notifications sent: ${successful} successful, ${failed} failed`
        )
      );
    } catch (error) {
      console.error("Send service notification error:", error);
      res
        .status(500)
        .json(
          createErrorResponse(
            "Failed to send service notifications",
            error.message
          )
        );
    }
  }
);

// Update token notification preferences
app.post(
  "/updateTokenStatus",
  registrationLimiter,
  [
    body("tokenId").notEmpty().withMessage("Token ID is required"),
    body("generalNotificationsAllowed")
      .isBoolean()
      .withMessage("Notification preference must be boolean"),
    body("userId").notEmpty().withMessage("User ID is required"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { tokenId, generalNotificationsAllowed, userId } = req.body;

      const updateData = {
        generalNotificationsAllowed,
        userId,
        updatedAt: new Date().toISOString(),
      };

      const { data, error } = await supabase.supabase
        .from("user_tokens")
        .update(updateData)
        .eq("token", tokenId)
        .select()
        .single();

      if (error) throw error;

      res.json(
        createSuccessResponse(data, "Token status updated successfully")
      );
    } catch (error) {
      console.error("Update token status error:", error);
      res
        .status(500)
        .json(
          createErrorResponse("Failed to update token status", error.message)
        );
    }
  }
);

// Update service subscriptions
app.post(
  "/updateNotificationServices",
  registrationLimiter,
  [
    body("service_id").notEmpty().withMessage("Service ID is required"),
    body("token").notEmpty().withMessage("Token is required"),
    body("action")
      .isBoolean()
      .withMessage("Action must be boolean (true to add, false to remove)"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { service_id, token, action } = req.body;

      // Get current subscriptions
      const { data: currentData, error: fetchError } = await supabase.supabase
        .from("user_tokens")
        .select("service_subscribed")
        .eq("token", token)
        .single();

      if (fetchError) throw fetchError;

      let subscriptions = currentData?.service_subscribed || [];

      // Update subscriptions array
      if (action) {
        // Add service if not already subscribed
        if (!subscriptions.includes(service_id)) {
          subscriptions.push(service_id);
        }
      } else {
        // Remove service
        subscriptions = subscriptions.filter((id) => id !== service_id);
      }

      // Update in database
      const { data, error } = await supabase.supabase
        .from("user_tokens")
        .update({
          service_subscribed: subscriptions,
          updatedAt: new Date().toISOString(),
        })
        .eq("token", token)
        .select()
        .single();

      if (error) throw error;

      res.json(
        createSuccessResponse(
          data,
          `Service subscription ${action ? "added" : "removed"} successfully`
        )
      );
    } catch (error) {
      console.error("Update service subscription error:", error);
      res
        .status(500)
        .json(
          createErrorResponse(
            "Failed to update service subscription",
            error.message
          )
        );
    }
  }
);

// Get user notification settings
app.get(
  "/getNotificationsUser/:token",
  [param("token").notEmpty().withMessage("Token is required")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token } = req.params;
      const userData = await getUserByToken(token);

      res.json(
        createSuccessResponse(userData, "User data retrieved successfully")
      );
    } catch (error) {
      console.error("Get user notifications error:", error);
      res
        .status(404)
        .json(createErrorResponse("User not found", error.message));
    }
  }
);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "notification-service",
    version: "1.0.0",
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json(createErrorResponse("Internal server error"));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json(createErrorResponse("Endpoint not found"));
});

module.exports = app;
