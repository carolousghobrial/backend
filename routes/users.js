const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const supabase = require("../config/config");

// Parse application/json
app.use(bodyParser.json());

// Parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware to extract and verify JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token is required",
    });
  }

  try {
    // Verify the JWT token with Supabase
    const {
      data: { user },
      error,
    } = await supabase.supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(403).json({
      success: false,
      message: "Token verification failed",
    });
  }
};

// Optional auth middleware - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    try {
      const {
        data: { user },
        error,
      } = await supabase.supabase.auth.getUser(token);
      if (!error && user) {
        req.user = user;
        req.token = token;
      }
    } catch (error) {
      console.error("Optional auth error:", error);
    }
  }
  next();
};

// Rate limiting helper for password reset
const passwordResetAttempts = new Map();

const rateLimitPasswordReset = (req, res, next) => {
  const email = req.body.email;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 3;

  if (!email) {
    return next();
  }

  const attempts = passwordResetAttempts.get(email) || [];
  const recentAttempts = attempts.filter((time) => now - time < windowMs);

  if (recentAttempts.length >= maxAttempts) {
    return res.status(429).json({
      success: false,
      message:
        "Too many password reset attempts. Please wait 15 minutes before trying again.",
    });
  }

  // Add current attempt
  recentAttempts.push(now);
  passwordResetAttempts.set(email, recentAttempts);

  // Clean up old entries periodically
  if (Math.random() < 0.01) {
    // 1% chance to clean up
    for (const [email, attempts] of passwordResetAttempts.entries()) {
      const validAttempts = attempts.filter((time) => now - time < windowMs);
      if (validAttempts.length === 0) {
        passwordResetAttempts.delete(email);
      } else {
        passwordResetAttempts.set(email, validAttempts);
      }
    }
  }

  next();
};

// ==================== PUBLIC ROUTES ====================

app.get("/", async (req, res) => {
  res.json({
    success: true,
    message: "Users API is running",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Login endpoint - FIXED: Returns both access and refresh tokens
 */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    console.log("Login attempt for email:", email);

    // Authenticate with Supabase
    const { data: authData, error: authError } =
      await supabase.supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

    if (authError) {
      console.error("Auth error:", authError);
      return res.status(401).json({
        success: false,
        message: authError.message || "Invalid credentials",
      });
    }

    if (!authData.user || !authData.session) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed",
      });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("id", authData.user.id)
      .single();

    if (profileError) {
      console.error("Profile fetch error:", profileError);
      // Continue without profile data
    }

    const responseData = {
      success: true,
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token, // FIXED: Include refresh token
      user: profile || {
        id: authData.user.id,
        email: authData.user.email,
        ...authData.user.user_metadata,
      },
      session: authData.session,
    };

    console.log("Login successful for:", email);
    res.json(responseData);
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during login",
    });
  }
});

/**
 * Refresh token endpoint - FIXED: New endpoint to keep session alive
 */
app.post("/refreshToken", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    // Refresh the session using Supabase
    const { data: authData, error: authError } =
      await supabase.supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

    if (authError || !authData.session) {
      console.error("Token refresh error:", authError);
      return res.status(401).json({
        success: false,
        message: "Failed to refresh token",
      });
    }

    // Get updated user profile
    const { data: profile, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("id", authData.user.id)
      .single();

    if (profileError) {
      console.error("Profile fetch error:", profileError);
    }

    res.json({
      success: true,
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      user: profile || {
        id: authData.user.id,
        email: authData.user.email,
        ...authData.user.user_metadata,
      },
      session: authData.session,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during token refresh",
    });
  }
});

/**
 * Register endpoint
 */
app.post("/register", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      dob,
      cellphone,
      email,
      portal_id,
      password,
      family_id,
      family_role,
    } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({
        success: false,
        message: "Email, password, first name, and last name are required",
      });
    }

    const newUser = {
      first_name,
      last_name,
      dob: dob ? new Date(dob) : null,
      cellphone,
      email,
      portal_id,
      family_id,
      family_role,
    };
    console.log(newUser);

    console.log("Registering new user:", email);

    const { data: authData, error: authError } =
      await supabase.supabase.auth.signUp({
        email: newUser.email,
        password: password,
        options: {
          data: {
            first_name: newUser.first_name,
            last_name: newUser.last_name,
            dob: newUser.dob,
            cellphone: newUser.cellphone,
            portal_id: newUser.portal_id,
            family_id: newUser.family_id,
            family_role: newUser.family_role,
          },
        },
      });

    if (authError) {
      console.error("Registration error:", authError);

      // Handle "User already registered" (status 422)
      if (
        authError.status === 422 &&
        authError.message.includes("User already registered")
      ) {
        // Fetch the existing user
        const { data: existingUser, error: fetchError } =
          await supabase.supabase
            .from("profiles")
            .select("*")
            .eq("email", newUser.email)
            .maybeSingle();

        if (fetchError) {
          console.error("Failed to fetch existing user:", fetchError.message);
          return res.status(500).json({
            success: false,
            message: "User exists, but failed to retrieve profile.",
          });
        }

        return res.status(409).json({
          success: false,
          message: "User already registered",
          user: existingUser,
        });
      }
      console.log(authError);
      return res.status(400).json({
        success: false,
        message: authError.message,
      });
    }

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: authData.user,
      session: authData.session,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during registration",
    });
  }
});

/**
 * Forgot password endpoint - FIXED VERSION
 */
app.post("/forgotPassword", rateLimitPasswordReset, async (req, res) => {
  try {
    console.log("=== Forgot Password Request ===");
    const { email } = req.body;
    console.log("Email received:", email);

    // Validate input
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // Check if user exists in profiles table
    const { data: profile, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (profileError) {
      console.error("Profile check error:", profileError);
      return res.status(500).json({
        success: false,
        message: "Error checking user profile",
      });
    }

    if (!profile) {
      // Don't reveal if user exists for security
      return res.json({
        success: true,
        message:
          "If an account exists with this email, a password reset link has been sent",
      });
    }

    // Send password reset email via Supabase
    const { data, error } = await supabase.supabase.auth.resetPasswordForEmail(
      email
    );

    if (error) {
      console.error("Supabase reset error:", error);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to send reset email",
      });
    }

    console.log("Password reset email sent successfully to:", email);
    res.json({
      success: true,
      message:
        "If an account exists with this email, a password reset link has been sent",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * Reset password endpoint
 */
app.post("/resetPassword", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: "Token and new password are required",
      });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    const { data, error } = await supabase.supabase.auth.updateUser({
      password: password,
    });

    if (error) {
      console.error("Reset password error:", error);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to reset password",
      });
    }

    res.json({
      success: true,
      message: "Password reset successfully",
      user: data.user,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * Logout endpoint
 */
app.post("/logout", authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase.supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to logout",
      });
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during logout",
    });
  }
});

/**
 * Update user profile
 */
app.put("/updateUser/:userId", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      first_name,
      last_name,
      dob,
      cellphone,
      portal_id,
      family_id,
      family_role,
    } = req.body;

    const updates = {
      first_name,
      last_name,
      dob: dob ? new Date(dob) : null,
      cellphone,
      portal_id,
      family_id,
      family_role,
      updated_at: new Date().toISOString(),
    };

    // Remove undefined fields
    Object.keys(updates).forEach((key) =>
      updates[key] === undefined ? delete updates[key] : {}
    );

    const { data, error } = await supabase.supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("Update user error:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.json({
      success: true,
      message: "User updated successfully",
      data: data,
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user",
    });
  }
});

/**
 * Create user (for admin purposes)
 */
app.post("/createUser", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      dob,
      cellphone,
      email,
      portal_id,
      family_id,
      family_role,
    } = req.body;

    if (!email || !first_name || !last_name) {
      return res.status(400).json({
        success: false,
        message: "Email, first name, and last name are required",
      });
    }

    const newUser = {
      first_name,
      last_name,
      dob: dob ? new Date(dob) : null,
      cellphone,
      email,
      portal_id,
      family_id,
      family_role,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.supabase
      .from("profiles")
      .insert([newUser])
      .select()
      .single();

    if (error) {
      console.error("Create user error:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: data,
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create user",
    });
  }
});

/**
 * Get user roles and services
 */
app.get("/getRolesAndServiceOfUser/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: rpcData, error: rpcError } = await supabase.supabase.rpc(
      "get_user_roles_and_services",
      { p_user_id: userId }
    );

    if (rpcError) {
      console.error("Get user roles error:", rpcError);
      return res.status(500).json({
        success: false,
        message: rpcError.message,
      });
    }

    res.json({
      success: true,
      data: rpcData || [],
    });
  } catch (error) {
    console.error("Get user roles error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user roles",
    });
  }
});

/**
 * Get family users for head
 */
app.get(
  "/getFamilyUsersForHead/:familyId",
  authenticateToken,
  async (req, res) => {
    try {
      const { familyId } = req.params;

      const { data: profiles, error } = await supabase.supabase
        .from("profiles")
        .select("*")
        .eq("family_id", familyId)
        .order("family_role", { ascending: true });

      if (error) {
        console.error("Get family users error:", error);
        return res.status(500).json({
          success: false,
          message: error.message,
        });
      }

      res.json({
        success: true,
        data: profiles || [],
      });
    } catch (error) {
      console.error("Get family users error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch family users",
      });
    }
  }
);

/**
 * Delete user (admin only)
 */
app.delete("/deleteUser/:uid", authenticateToken, async (req, res) => {
  try {
    const { uid } = req.params;

    // Delete from Supabase Auth
    const { data: authData, error: authError } =
      await supabase.supabase.auth.admin.deleteUser(uid);

    if (authError) {
      console.error("Delete user auth error:", authError);
      return res.status(500).json({
        success: false,
        message: authError.message,
      });
    }

    // Also delete from profiles table
    const { error: profileError } = await supabase.supabase
      .from("profiles")
      .delete()
      .eq("id", uid);

    if (profileError) {
      console.warn("Delete user profile error:", profileError);
    }

    res.json({
      success: true,
      message: "User deleted successfully",
      data: authData,
    });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
    });
  }
});

/**
 * Register without email verification (admin function)
 */
app.post("/registerwithoutemail", async (req, res) => {
  try {
    const {
      email,
      first_name,
      last_name,
      dob,
      cellphone,
      portal_id,
      family_id,
      family_role,
    } = req.body;

    // Check if user already exists
    const { data: existingProfile, error: checkError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("email", email);

    if (checkError && checkError.code !== "PGRST116") {
      console.error("Check existing user error:", checkError);
      return res.status(500).json({
        success: false,
        message: "Error checking existing user",
      });
    }

    const newUser = {
      id: existingProfile[0].id,
      first_name,
      last_name,
      dob: dob ? new Date(dob) : null,
      cellphone,
      email,
      portal_id,
      family_id,
      family_role,
    };

    const { data, error } = await supabase.supabase
      .from("profiles")
      .insert([newUser])
      .select()
      .single();

    if (error) {
      console.error("Register without email error:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.status(201).json({
      success: true,
      message: "User registered successfully without email verification",
      data: data,
    });
  } catch (error) {
    console.error("Register without email error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to register user",
    });
  }
});

// ==================== UTILITY ROUTES ====================

app.get("/getUserByPortalId/:portal_id", async (req, res) => {
  const { portal_id } = req.params;
  const { data: profile, error: checkError } = await supabase.supabase
    .from("profiles")
    .select("*")
    .eq("portal_id", portal_id)
    .single();

  res.send(profile);
});

/**
 * Get current user by token (alternative endpoint)
 */
app.get("/getCurrentUser/:uid", optionalAuth, async (req, res) => {
  try {
    const { uid } = req.params;

    const {
      data: { user },
      error,
    } = await supabase.supabase.auth.getUser(uid);

    if (error || !user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user: user.user_metadata || user,
      data: user,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user",
    });
  }
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Global error handler:", error);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    ...(process.env.NODE_ENV === "development" && { error: error.message }),
  });
});

module.exports = app;
