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
    }

    const responseData = {
      success: true,
      token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
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

      if (
        authError.status === 422 &&
        authError.message.includes("User already registered")
      ) {
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
 * Sends password reset email via Supabase
 */
app.post("/forgotPassword", rateLimitPasswordReset, async (req, res) => {
  try {
    console.log("=== Forgot Password Request ===");
    const { email } = req.body;

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

    const normalizedEmail = email.toLowerCase().trim();
    console.log("Password reset request for:", normalizedEmail);

    // Check if user exists (optional - for logging purposes)
    const { data: existingUser, error: userCheckError } =
      await supabase.supabase
        .from("profiles")
        .select("id, email, first_name")
        .eq("email", normalizedEmail)
        .maybeSingle();

    if (userCheckError && userCheckError.code !== "PGRST116") {
      console.error("Error checking user:", userCheckError);
    }

    // IMPORTANT: Configure your redirect URL here
    // This should match your frontend route for reset-password
    const frontendUrl =
      process.env.FRONTEND_URL || "https://www.stgeorgecocnashville.org";
    const redirectUrl = `${frontendUrl}/reset-password`;

    console.log("Redirect URL:", redirectUrl);

    // Send password reset email via Supabase
    const { data, error } = await supabase.supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      {
        redirectTo: redirectUrl,
      }
    );

    if (error) {
      console.error("Supabase reset error:", error);

      if (error.message.includes("rate limit")) {
        return res.status(429).json({
          success: false,
          message: "Too many requests. Please wait a few minutes.",
        });
      }

      // Don't reveal if user exists or not (security best practice)
      // Return success anyway
    }

    // Always return success to prevent email enumeration attacks
    console.log("Password reset email sent (if user exists):", normalizedEmail);

    res.json({
      success: true,
      message:
        "If an account with that email exists, we've sent a password reset link. Please check your inbox.",
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred. Please try again later.",
    });
  }
});

/**
 * Verify password reset token
 * Validates that the access_token from Supabase is valid
 */
app.post("/verifyResetToken", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Reset token is required",
      });
    }

    console.log("=== Verifying Reset Token ===");
    console.log("Token length:", token.length);

    // Verify the token by getting the user
    const {
      data: { user },
      error,
    } = await supabase.supabase.auth.getUser(token);

    if (error) {
      console.error("Token verification error:", error);
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token. Please request a new one.",
      });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid token - no user found.",
      });
    }

    // Get additional user info from profiles
    const { data: profile } = await supabase.supabase
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();

    const userEmail = profile?.email || user.email;

    console.log("✅ Token verified for:", userEmail);

    res.json({
      success: true,
      message: "Reset token is valid",
      email: userEmail,
      userId: user.id,
    });
  } catch (error) {
    console.error("Verify token error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while verifying the token.",
    });
  }
});

/**
 * Reset password endpoint
 * Uses the access_token to update the user's password
 */
app.post("/resetPassword", async (req, res) => {
  try {
    const { token, new_password } = req.body;

    console.log("=== Password Reset Request ===");

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Access token is required",
      });
    }

    if (!new_password) {
      return res.status(400).json({
        success: false,
        message: "New password is required",
      });
    }

    // Validate password strength
    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    const hasUpperCase = /[A-Z]/.test(new_password);
    const hasLowerCase = /[a-z]/.test(new_password);
    const hasNumber = /[0-9]/.test(new_password);

    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      return res.status(400).json({
        success: false,
        message: "Password must contain uppercase, lowercase, and a number",
      });
    }

    // First, verify the token is valid
    const {
      data: { user },
      error: getUserError,
    } = await supabase.supabase.auth.getUser(token);

    if (getUserError || !user) {
      console.error("Token validation failed:", getUserError);
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token. Please request a new reset link.",
      });
    }

    console.log("Token valid for user:", user.email);

    // Update the password using Supabase Auth API directly
    // This requires making a direct call to Supabase's auth endpoint
    const supabaseUrl =
      process.env.SUPABASE_URL || supabase.supabase.supabaseUrl;
    const supabaseKey =
      process.env.SUPABASE_ANON_KEY || supabase.supabase.supabaseKey;

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        apikey: supabaseKey,
      },
      body: JSON.stringify({
        password: new_password,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Password update failed:", result);

      // Handle specific error cases
      if (
        result.error_description?.includes("expired") ||
        result.msg?.includes("expired")
      ) {
        return res.status(400).json({
          success: false,
          message: "Your reset link has expired. Please request a new one.",
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message || result.msg || "Failed to update password.",
      });
    }

    console.log("✅ Password updated successfully for:", user.email);

    // Sign out all sessions for security
    try {
      await supabase.supabase.auth.admin.signOut(user.id, "global");
    } catch (signOutError) {
      console.warn("Could not sign out all sessions:", signOutError);
      // Continue anyway - password was still reset
    }

    res.json({
      success: true,
      message:
        "Password reset successful! You can now login with your new password.",
      email: user.email,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while resetting the password.",
    });
  }
});

// ==================== AUTHENTICATED ROUTES ====================

/**
 * Get logged in user info
 */
app.get("/getLoggedIn", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: authProfile, error: authError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("id", userId);

    if (authError || !authProfile) {
      console.error("Auth profile fetch error:", authError);
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    const portal_ids = authProfile.map((profile) => profile.portal_id);

    const { data: profiles, error: profileError } = await supabase.supabase.rpc(
      "get_family_children",
      { portal_id_in: portal_ids }
    );

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

    // Fetch profile images
    const profilesWithImages = await Promise.all(
      profiles.map(async (profile) => {
        let profileImageUrl = null;

        try {
          const imageResponse = await fetch(
            `https://api.suscopts.org/image/${profile.portal_id}`
          );

          if (imageResponse.ok) {
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Image = Buffer.from(imageBuffer).toString("base64");
            profileImageUrl = `data:${imageResponse.headers.get(
              "content-type"
            )};base64,${base64Image}`;
          }
        } catch (imageError) {
          console.warn(`Failed to fetch image for ${profile.portal_id}`);
        }

        return {
          id: profile.id,
          portal_id: profile.portal_id,
          first_name: profile.first_name || "",
          last_name: profile.last_name || "",
          email: profile.email,
          cellphone: profile.cellphone,
          family_id: profile.family_id,
          family_role: profile.family_role,
          profile_pic: profileImageUrl,
        };
      })
    );

    res.json({
      success: true,
      user: profilesWithImages[0],
      users: profilesWithImages,
      data: {
        user: profilesWithImages[0],
        users: profilesWithImages,
        count: profilesWithImages.length,
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
 * Refresh access token
 */
app.post("/refreshToken", async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    const { data, error } = await supabase.supabase.auth.refreshSession({
      refresh_token: refresh_token,
    });

    if (error || !data.session) {
      console.error("Token refresh error:", error);
      return res.status(401).json({
        success: false,
        message: "Failed to refresh token",
      });
    }

    res.json({
      success: true,
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      session: data.session,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * Get parent's children
 */
app.get("/getParentChildren", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: authProfile, error: authError } = await supabase.supabase
      .from("profiles")
      .select("email, family_id, family_role")
      .eq("id", userId)
      .limit(1)
      .single();

    if (authError || !authProfile) {
      return res.status(404).json({
        success: false,
        message: "Parent profile not found",
      });
    }

    if (authProfile.family_role !== "PARENT") {
      return res.status(403).json({
        success: false,
        message: "Only parents can view their children",
      });
    }

    const { data: familyProfiles, error: familyError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("family_id", authProfile.family_id)
      .order("family_role", { ascending: true });

    if (familyError) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch family profiles",
      });
    }

    // Filter children under 18
    const childrenUnder18 = familyProfiles.filter((profile) => {
      const isChild = profile.family_role?.toLowerCase() !== "parent";
      if (!isChild) return false;

      if (profile.dob) {
        const birthDate = new Date(profile.dob);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();

        if (
          monthDiff < 0 ||
          (monthDiff === 0 && today.getDate() < birthDate.getDate())
        ) {
          age--;
        }

        return age < 18;
      }

      return true;
    });

    // Fetch profile images
    const childrenWithImages = await Promise.all(
      childrenUnder18.map(async (child) => {
        let profileImageUrl = null;

        try {
          const imageResponse = await fetch(
            `https://api.suscopts.org/image/${child.portal_id}`
          );

          if (imageResponse.ok) {
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Image = Buffer.from(imageBuffer).toString("base64");
            profileImageUrl = `data:${imageResponse.headers.get(
              "content-type"
            )};base64,${base64Image}`;
          }
        } catch (imageError) {
          // Ignore image fetch errors
        }

        let childAge = null;
        if (child.dob) {
          const birthDate = new Date(child.dob);
          const today = new Date();
          childAge = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();

          if (
            monthDiff < 0 ||
            (monthDiff === 0 && today.getDate() < birthDate.getDate())
          ) {
            childAge--;
          }
        }

        return {
          id: child.id,
          portal_id: child.portal_id,
          first_name: child.first_name || "",
          last_name: child.last_name || "",
          email: child.email,
          cellphone: child.cellphone,
          family_id: child.family_id,
          family_role: child.family_role,
          dob: child.dob,
          age: childAge,
          profile_pic: profileImageUrl,
        };
      })
    );

    res.json({
      success: true,
      data: {
        children: childrenWithImages,
        count: childrenWithImages.length,
        parentEmail: authProfile.email,
        familyId: authProfile.family_id,
      },
    });
  } catch (error) {
    console.error("Get parent children error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get children information",
    });
  }
});

/**
 * Verify parent-child relationship
 */
app.post("/verifyParentChild", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { childPortalId } = req.body;

    if (!childPortalId) {
      return res.status(400).json({
        success: false,
        message: "childPortalId is required",
      });
    }

    const { data: parentProfile, error: parentError } = await supabase.supabase
      .from("profiles")
      .select("family_id, family_role, email")
      .eq("id", userId)
      .limit(1)
      .single();

    if (
      parentError ||
      !parentProfile ||
      parentProfile.family_role !== "PARENT"
    ) {
      return res.status(403).json({
        success: false,
        message: "User is not a parent",
      });
    }

    const { data: childProfile, error: childError } = await supabase.supabase
      .from("profiles")
      .select("family_id, family_role, dob, first_name, last_name")
      .eq("portal_id", childPortalId)
      .limit(1)
      .single();

    if (childError || !childProfile) {
      return res.status(404).json({
        success: false,
        message: "Child profile not found",
      });
    }

    if (parentProfile.family_id !== childProfile.family_id) {
      return res.status(403).json({
        success: false,
        message: "Parent-child relationship not verified",
      });
    }

    let childAge = null;
    if (childProfile.dob) {
      const birthDate = new Date(childProfile.dob);
      const today = new Date();
      childAge = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birthDate.getDate())
      ) {
        childAge--;
      }
    }

    if (childAge !== null && childAge >= 18) {
      return res.status(403).json({
        success: false,
        message: "Child is 18 or older. Parent cannot switch to this child.",
      });
    }

    res.json({
      success: true,
      data: {
        verified: true,
        childName: `${childProfile.first_name} ${childProfile.last_name}`,
        childAge: childAge,
        parentEmail: parentProfile.email,
      },
    });
  } catch (error) {
    console.error("Verify parent-child error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify parent-child relationship",
    });
  }
});

/**
 * Logout endpoint
 */
app.post("/logout", authenticateToken, async (req, res) => {
  try {
    await supabase.supabase.auth.signOut();

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
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

    if (error) {
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

app.get("/getAuthEmails", async (req, res) => {
  try {
    const { data, error } = await supabase.supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.send(data.users);
  } catch (error) {
    console.error("Get auth emails error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
});

app.get("/getUserEmails", async (req, res) => {
  try {
    const { data, error } = await supabase.supabase.rpc("get_all_user_emails");

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    const emailStrings = data.map((item) => item.email);
    res.send(emailStrings);
  } catch (error) {
    console.error("Get user emails error:", error);
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

    const { data: profile, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();

    if (profileError) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: [profile],
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
    const cleanPortalId = String(portal_id).trim();

    const { data: profile, error } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("portal_id", cleanPortalId)
      .single();

    if (error) {
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

app.post("/updateUser/:portal_id", authenticateToken, async (req, res) => {
  try {
    const { portal_id } = req.params;
    const { first_name, last_name, dob, cellphone, email, shirt_size } =
      req.body;

    const updateData = {
      first_name,
      last_name,
      cellphone,
      email,
      shirt_size,
    };

    if (dob) {
      updateData.dob = new Date(dob);
    }

    const { data, error } = await supabase.supabase
      .from("profiles")
      .update(updateData)
      .eq("portal_id", portal_id)
      .select()
      .single();

    if (error) {
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
 * Create user
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
 * Delete user
 */
app.delete("/deleteUser/:uid", authenticateToken, async (req, res) => {
  try {
    const { uid } = req.params;

    const { data: authData, error: authError } =
      await supabase.supabase.auth.admin.deleteUser(uid);

    if (authError) {
      return res.status(500).json({
        success: false,
        message: authError.message,
      });
    }

    await supabase.supabase.from("profiles").delete().eq("id", uid);

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
 * Register without email verification
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

    const { data: existingProfile, error: checkError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("email", email);

    if (checkError && checkError.code !== "PGRST116") {
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

app.get("/getUserByPortalId/:portal_id", async (req, res) => {
  const { portal_id } = req.params;
  const { data: profile, error } = await supabase.supabase
    .from("profiles")
    .select("*")
    .eq("portal_id", portal_id)
    .single();

  res.send(profile);
});

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
