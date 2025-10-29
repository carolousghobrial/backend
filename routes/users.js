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
      refresh_token: authData.session.refresh_token, // Add this line
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
      // Return success anyway for security (don't reveal if email exists)
      return res.json({
        success: true,
        message:
          "If an account with that email exists, we've sent a password reset link.",
        email: email,
      });
    }

    // CRITICAL FIX: Updated redirect URL to match Supabase token delivery
    const frontendUrl = "https://www.stgeorgecocnashville.org";
    const redirectUrl = `${frontendUrl}/reset-password`;

    console.log("Sending password reset email with redirect to:", redirectUrl);

    // Send password reset email via Supabase Auth
    const { data, error } = await supabase.supabase.auth.resetPasswordForEmail(
      email.toLowerCase().trim(),
      {
        redirectTo: redirectUrl,
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
        // Return success for security
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

/**
 * Verify password reset token endpoint - FIXED VERSION
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

    console.log("Verifying reset token...");

    // Verify the session token directly with Supabase
    const {
      data: { user },
      error,
    } = await supabase.supabase.auth.getUser(token);

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

    console.log("Token verified successfully for:", userEmail);

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
 * Password reset endpoint - FIXED VERSION
 */
app.post("/resetPassword", async (req, res) => {
  try {
    const { token, new_password } = req.body;

    console.log("=== Password Reset Debug ===");
    console.log("Token received:", token ? "Present" : "Missing");
    console.log("Token length:", token ? token.length : 0);
    console.log("Password received:", new_password ? "Present" : "Missing");

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

    console.log("Attempting password reset...");

    // First verify the token is valid by getting the user
    const {
      data: { user },
      error: getUserError,
    } = await supabase.supabase.auth.getUser(token);

    if (getUserError || !user) {
      console.error("Token validation failed:", getUserError);
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    console.log("Token valid for user:", user.email);

    // Make direct API call to Supabase to update password
    const supabaseUrl =
      process.env.SUPABASE_URL || "https://oplzcugljytvywvewdkj.supabase.co";
    const supabaseAnonKey =
      process.env.SUPABASE_ANON_KEY || supabase.supabase.supabaseKey;

    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          password: new_password,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error("Password update error via API:", result);
        return res.status(400).json({
          success: false,
          message: result.message || "Failed to update password",
        });
      }

      console.log("Password updated successfully for user:", user.email);

      res.json({
        success: true,
        message:
          "Password reset successfully. You can now login with your new password.",
        user: {
          id: user.id,
          email: user.email,
        },
      });
    } catch (fetchError) {
      console.error("Fetch error:", fetchError);
      return res.status(500).json({
        success: false,
        message: "Failed to communicate with authentication service",
      });
    }
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while resetting the password",
    });
  }
});

// ==================== AUTHENTICATED ROUTES ====================

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
      .select("*")
      .eq("id", userId)
      .limit(1)
      .single();

    if (authError || !authProfile) {
      console.error("Auth profile fetch error:", authError);
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    // Get all profiles with the same email (multiple church profiles)
    const { data: profiles, error: profileError } = await supabase.supabase.rpc(
      "get_family_children",
      {
        portal_id_in: authProfile.portal_id,
      }
    );
    console.log(profiles);
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

    // Fetch profile images for each profile
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
          console.warn(
            `Failed to fetch image for portal_id ${profile.portal_id}:`,
            imageError.message
          );
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
    console.log(profilesWithImages);
    // Return consistent response format
    res.json({
      success: true,
      user: profilesWithImages[0], // Primary profile
      users: profilesWithImages, // All profiles
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

    console.log("Refreshing token...");

    // Refresh the session using Supabase
    const { data, error } = await supabase.supabase.auth.refreshSession({
      refresh_token: refresh_token,
    });

    if (error) {
      console.error("Token refresh error:", error);
      return res.status(401).json({
        success: false,
        message: "Failed to refresh token",
      });
    }

    if (!data.session) {
      return res.status(401).json({
        success: false,
        message: "No session returned",
      });
    }

    console.log("Token refreshed successfully");

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
      message: "Internal server error during token refresh",
    });
  }
});
// ==================== BACKEND SOLUTION ====================
// File: routes/users.js or similar

/**
 * Get parent's children (for parent user switching)
 * Parents can only view children under 18 years old
 */
app.get("/getParentChildren", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get the authenticated parent's profile
    const { data: authProfile, error: authError } = await supabase.supabase
      .from("profiles")
      .select("email, family_id, family_role")
      .eq("id", userId)
      .limit(1)
      .single();

    if (authError || !authProfile) {
      console.error("Auth profile fetch error:", authError);
      return res.status(404).json({
        success: false,
        message: "Parent profile not found",
      });
    }

    // Verify user is a parent
    const isParent = authProfile.family_role === "PARENT";
    if (!isParent) {
      return res.status(403).json({
        success: false,
        message: "Only parents can view their children",
      });
    }

    // Get all profiles with same family_id (children and parent)
    const { data: familyProfiles, error: familyError } = await supabase.supabase
      .from("profiles")
      .select("*")
      .eq("family_id", authProfile.family_id)
      .order("family_role", { ascending: true });

    if (familyError) {
      console.error("Family profiles fetch error:", familyError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch family profiles",
      });
    }

    if (!familyProfiles || familyProfiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No family profiles found",
      });
    }

    // ========== CRITICAL: Filter children under 18 ==========
    const childrenUnder18 = familyProfiles.filter((profile) => {
      // Check if it's a child (not parent)
      const isChild =
        profile.family_role && profile.family_role.toLowerCase() !== "parent";

      if (!isChild) return false;

      // Calculate age from DOB
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

        // Only include children under 18
        return age < 18;
      }

      // If no DOB, include by default (safer approach)
      return true;
    });

    // Fetch profile images for each child
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
          console.warn(
            `Failed to fetch image for portal_id ${child.portal_id}:`,
            imageError.message
          );
        }

        // Calculate child's age for display
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
          age: childAge, // Add age for display
          profile_pic: profileImageUrl,
        };
      })
    );

    // Log for debugging
    console.log(
      `✅ Found ${childrenWithImages.length} children under 18 for parent ${authProfile.email}`
    );

    // Return response
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
 * Verify parent-child relationship before switching
 * This is important for security - verify the parent owns the child
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

    // Get parent's profile
    const { data: parentProfile, error: parentError } = await supabase.supabase
      .from("profiles")
      .select("family_id, family_role, email")
      .eq("id", userId)
      .limit(1)
      .single();

    if (parentError || !parentProfile) {
      return res.status(404).json({
        success: false,
        message: "Parent profile not found",
      });
    }

    // Verify parent
    if (parentProfile.family_role !== "PARENT") {
      return res.status(403).json({
        success: false,
        message: "User is not a parent",
      });
    }

    // Get child's profile
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

    // Verify parent and child share same family_id
    if (parentProfile.family_id !== childProfile.family_id) {
      return res.status(403).json({
        success: false,
        message: "Parent-child relationship not verified",
      });
    }

    // Verify child is under 18
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

    // Verification successful
    console.log(
      `✅ Parent ${parentProfile.email} verified as parent of ${childProfile.first_name} ${childProfile.last_name}`
    );

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

app.get("/getAuthEmails", async (req, res) => {
  try {
    const perPage = 1000;
    let page = 1;
    const { data, error } = await supabase.supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      console.error("Get users error:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.send(data.users);
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
    const { data, error } = await supabase.supabase.rpc("get_all_user_emails");

    if (error) {
      console.error("Get users error:", error);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    // Extract just the email strings from the array of objects
    const emailStrings = data.map((item) => item.email);
    res.send(emailStrings);
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
