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
 * Forgot password endpoint
 */
app.post("/forgotPassword", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const { data, error } = await supabase.supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
      }
    );

    if (error) {
      console.error("Password reset error:", error);
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.json({
      success: true,
      message: "Password reset email sent successfully",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// ==================== AUTHENTICATED ROUTES ====================

/**
 * Get logged in user info - FIXED
 */
app.get("/getLoggedIn", authenticateToken, async (req, res) => {
  try {
    // Get user profile from database
    const { data: profile, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("id", req.user.id)
      .single();

    const userData = profile || {
      id: req.user.id,
      email: req.user.email,
      ...req.user.user_metadata,
    };

    res.json({
      success: true,
      user: userData,
      authenticated: true,
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
 * Logout endpoint - FIXED
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
app.get("/getUsers", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase.supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get users error:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
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
      "getuserwithrolesandservices",
      { user_uuid: id }
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
app.get("/getUserByPortal/:portal_id", authenticateToken, async (req, res) => {
  try {
    const { portal_id } = req.params;

    const { data: profile, error } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("portal_id", portal_id)
      .single();

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
app.post("/createUser", authenticateToken, async (req, res) => {
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
app.get(
  "/getRolesAndServiceOfUser/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const { userId } = req.params;

      const { data: userServiceRoles, error } = await supabase.supabase
        .from("user_service_roles")
        .select(
          `
        *,
        roles:role_id (
          role_id,
          role_name
        ),
        services:service_id (
          service_id,
          service_title
        )
      `
        )
        .eq("user_id", userId);

      if (error) {
        console.error("Get user roles error:", error);
        return res.status(500).json({
          success: false,
          message: error.message,
        });
      }

      res.json({
        success: true,
        data: userServiceRoles || [],
      });
    } catch (error) {
      console.error("Get user roles error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch user roles",
      });
    }
  }
);

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
app.post("/registerwithoutemail", authenticateToken, async (req, res) => {
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
      .eq("email", email)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 means no rows found
      console.error("Check existing user error:", checkError);
      return res.status(500).json({
        success: false,
        message: "Error checking existing user",
      });
    }

    if (existingProfile) {
      return res.status(409).json({
        success: false,
        message: "User with this email already exists",
        user: existingProfile,
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
