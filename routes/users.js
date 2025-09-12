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
 * Login endpoint
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
 * Verify password reset token endpoint
 */
app.post("/verifyResetToken/:token", async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Reset token is required",
      });
    }
    console.log(token);

    console.log("Verifying reset token:", token);

    // Verify the token with Supabase
    const {
      data: { user },
      error,
    } = await supabase.supabase.auth.verifyOtp({
      type: "recovery",
      token_hash: token, // token from your reset link
    });
    if (error || !user) {
      console.error("Token verification error:", error);
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    // Get user profile for additional info
    const { data: profile, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", user.id)
      .single();

    const userEmail = profile?.email || user.email;

    res.json({
      success: true,
      message: "Reset token is valid",
      email: userEmail,
      user: {
        id: user.id,
        email: userEmail,
      },
    });
  } catch (error) {
    console.error("Verify reset token error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while verifying the reset token",
    });
  }
});

/**
 * Password reset endpoint - handles Supabase password reset tokens
 */
app.post("/resetPassword", async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({
        success: false,
        message: "Access token and new password are required",
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    // Now update the password
    const { data: updatedUser, error: updateError } =
      await supabase.supabase.auth.updateUser({
        password: new_password,
      });

    if (updateError) {
      console.error("Password update error:", updateError.message);
      return res.status(400).json({
        success: false,
        message: "Failed to update password",
      });
    }

    res.json({
      success: true,
      message: "Password reset successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while resetting the password",
    });
  }
});

/**
 * Verify reset token endpoint - optional helper to validate tokens
 */
app.post("/verifyResetToken", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Token is required",
      });
    }

    // Create temporary client to verify token
    const supabaseClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Try to set session with the token
    const { data, error } = await supabaseClient.auth.setSession({
      access_token: token,
      refresh_token: token,
    });

    if (error) {
      console.error("Token verification failed:", error.message);
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    // Clean up session
    await supabaseClient.auth.signOut();

    res.json({
      success: true,
      message: "Token is valid",
      email: data.user?.email || "",
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while verifying the token",
    });
  }
});

// Remove the duplicate endpoints at the bottom of your file:
// Delete these duplicate endpoints:
// app.post("/reset-password", ...)
// app.get("/verify-reset-token/:token", ...)

// Update your forgot password to ensure proper redirect URL
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
        message: "Please enter a valid email address",
      });
    }

    console.log("Password reset request for email:", email);

    // Check if user exists in profiles table first
    const { data: existingUser, error: userCheckError } =
      await supabase.supabase
        .from("profiles")
        .select("id, email, first_name, last_name")
        .eq("email", email.toLowerCase().trim())
        .single();

    if (userCheckError && userCheckError.code !== "PGRST116") {
      console.error("Error checking user existence:", userCheckError);
      return res.status(500).json({
        success: false,
        message: "An error occurred while processing your request",
      });
    }

    if (!existingUser) {
      console.log("Password reset requested for non-existent email:", email);
      return res.json({
        success: true,
        message:
          "If an account with that email exists, we've sent a password reset link.",
        email: email,
      });
    }

    // Updated redirect URL to match your email template pattern
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:4200";
    const redirectUrl = `${frontendUrl}/reset-password`; // Base URL, token will be appended by Supabase

    console.log("Sending password reset email with redirect to:", redirectUrl);

    // Send password reset email via Supabase Auth
    const { data, error } = await supabase.supabase.auth.resetPasswordForEmail(
      email.toLowerCase().trim(),
      {
        redirectTo: redirectUrl,
        data: {
          user_name: existingUser.first_name || "User",
        },
      }
    );

    if (error) {
      console.error("Supabase password reset error:", error);

      if (error.message.includes("rate limit")) {
        return res.status(429).json({
          success: false,
          message:
            "Too many reset requests. Please wait a few minutes before trying again.",
        });
      }

      if (error.message.includes("not found")) {
        return res.json({
          success: true,
          message:
            "If an account with that email exists, we've sent a password reset link.",
          email: email,
        });
      }

      return res.status(400).json({
        success: false,
        message: "Unable to send password reset email. Please try again later.",
      });
    }

    console.log("Password reset email sent successfully to:", email);

    // Optional: Log the reset request

    res.json({
      success: true,
      message:
        "We've sent a password reset link to your email address. Please check your inbox and follow the instructions.",
      email: email,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "An internal error occurred. Please try again later.",
    });
  }
});

// ==================== AUTHENTICATED ROUTES ====================

/**
 * Get logged in user info
 */
/**
 * Get logged in user info
 */
app.get("/getLoggedIn", authenticateToken, async (req, res) => {
  try {
    // User is already verified by authenticateToken middleware
    const userId = req.user.id;

    // First get the authenticated user's email
    const { data: authProfile, error: authError } = await supabase.supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .limit(1)
      .single();
    console.log(authProfile);
    console.log(authError);
    if (authError || !authProfile) {
      console.error("Auth profile fetch error:", authError);
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    // Get all profiles with the same email (multiple church profiles)
    const { data: profiles, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("email", authProfile.email)
      .order("portal_id", { ascending: true });

    if (profileError) {
      console.error("Profiles fetch error:", profileError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user profiles",
      });
    }

    if (!profiles || profiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No profiles found",
      });
    }

    // Return consistent response format
    res.json({
      success: true,
      user: profiles[0], // Primary profile
      users: profiles, // All profiles
      data: {
        user: profiles[0],
        users: profiles,
        count: profiles.length,
      },
    });
  } catch (error) {
    console.error("Get logged in user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user information",
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
      // Don't fail the logout on client side even if server logout fails
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    // Still return success for client-side cleanup
    res.json({
      success: true,
      message: "Logged out successfully",
    });
  }
});

/**
 * Get all users
 */
app.get("/getUsers", async (req, res) => {
  try {
    const { data, error } = await supabase.supabase
      .from("profiles")
      .select("*")
      .order("portal_id", { ascending: false });
    console.log(error);
    if (error) {
      console.error("Get users error:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.send(data);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
});
app.get("/getUserEmails", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc("get_all_user_emails");
    console.log(error);
    if (error) {
      console.error("Get users error:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.send(data);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
});
app.get("/addProfilesToUserService", async (req, res) => {
  try {
    // 1. Get all profiles
    const { data: profiles, error } = await supabase.supabase
      .from("profiles")
      .select("*")
      .order("portal_id", { ascending: false });

    if (error) {
      console.error("Get users error:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    // 2. Insert each profile into user_service_roles
    for (const profile of profiles) {
      if (profile.email == "fr.serapion@gmail.com") {
        const { error: insertError } = await supabase.supabase
          .from("user_service_roles") // 👈 change this to your target table
          .insert({
            portal_id: profile.portal_id, // 👈 adjust column names as needed
            role_id: "priest", // example static role
            service_id: "congregation", // example static service
          });
        if (insertError) {
          console.error(
            `Insert error for user ${profile.portal_id}:`,
            insertError.message
          );
        }
      } else {
        const { error: insertError } = await supabase.supabase
          .from("user_service_roles") // 👈 change this to your target table
          .insert({
            portal_id: profile.portal_id, // 👈 adjust column names as needed
            role_id: "member", // example static role
            service_id: "congregation", // example static service
          });
        if (insertError) {
          console.error(
            `Insert error for user ${profile.portal_id}:`,
            insertError.message
          );
        }
      }
    }

    res.json({
      success: true,
      message: "Profiles inserted into user_service_roles",
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * Get user by ID
 */
app.get("/getUserById/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    console.log("Getting user by ID:", id);

    // Try the RPC function first
    const { data: rpcData, error: rpcError } = await supabase.supabase.rpc(
      "get_user_roles_and_services",
      { p_user_id: id }
    );

    if (!rpcError && rpcData && rpcData.length > 0) {
      return res.json({
        success: true,
        data: rpcData,
      });
    }

    // Fallback to simple profile fetch
    const { data: profile, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();

    if (profileError) {
      console.error("Get user by ID error:", profileError);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: [profile], // Return as array for consistency
    });
  } catch (error) {
    console.error("Get user by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user",
    });
  }
});

/**
 * Get user by portal ID
 */
app.get("/getUserByPortal/:portal_id", async (req, res) => {
  try {
    const { portal_id } = req.params;

    // Keep as string since database column is text
    const cleanPortalId = String(portal_id).trim();

    const { data: profile, error } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("portal_id", cleanPortalId) // Remove parseInt() - keep as string
      .single();

    console.log("Searching for portal_id:", cleanPortalId);
    console.log("Found profile:", profile);

    if (error) {
      console.error("Get user by portal ID error:", error);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error("Get user by portal ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user",
    });
  }
});
/**
 * Update user
 */
app.post("/updateUser/:portal_id", authenticateToken, async (req, res) => {
  try {
    const { portal_id } = req.params;
    const { first_name, last_name, dob, cellphone, email } = req.body;

    const updateData = {
      first_name,
      last_name,
      cellphone,
      email,
    };

    // Only add dob if provided
    if (dob) {
      updateData.dob = new Date(dob);
    }

    console.log("Updating user:", portal_id, updateData);

    const { data, error } = await supabase.supabase
      .from("profiles")
      .update(updateData)
      .eq("portal_id", portal_id)
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
    console.log(userId);
    const { data: rpcData, error: rpcError } = await supabase.supabase.rpc(
      "get_user_roles_and_services",
      { p_user_id: userId }
    );
    console.log(rpcData);
    if (rpcError) {
      console.error("Get user roles error:", rpcError);
      return res.status(500).json({
        success: false,
        message: error.message,
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

    console.log("Deleting user:", uid);

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
      // Don't fail the entire operation if profile deletion fails
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
    console.log(email);
    // Check if user already exists
    const { data: existingProfile, error: checkError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("email", email);

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 means no rows found
      console.error("Check existing user error:", checkError);
      return res.status(500).json({
        success: false,
        message: "Error checking existing user",
      });
    }
    console.log(existingProfile);
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
  console.log(profile);
  res.send(profile);
});
/**
 * Get current user by token (alternative endpoint)
 */
app.get("/getCurrentUser/:uid", optionalAuth, async (req, res) => {
  try {
    const { uid } = req.params;

    // Try to get user by the provided token/uid
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
