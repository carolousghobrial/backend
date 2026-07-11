const supabase = require("../config/config");

const PRIVILEGED_ROLES = new Set([
  "priest",
  "coordinator",
  "sunday_school_coordinator",
  "deacon_school_coordinator",
  "deacon_school_principal",
]);

const CONFESSION_ADMIN_ROLES = new Set(["priest", "coordinator"]);
const ANNOUNCEMENT_ADMIN_ROLES = new Set([
  "priest",
  "coordinator",
  "sunday_school_coordinator",
]);
const SERVICE_ADMIN_ROLES = new Set(["priest", "coordinator"]);
const DEACONS_SCHOOL_WRITE_ROLES = new Set([
  "priest",
  "coordinator",
  "deacon_school_teacher",
  "deacon_school_coordinator",
  "deacon_school_principal",
]);

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token is required",
    });
  }

  try {
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
    return res.status(403).json({
      success: false,
      message: "Token verification failed",
    });
  }
};

const resolvePortalId = async (req) => {
  if (req.authPortalId) {
    return req.authPortalId;
  }

  const { data: profile, error } = await supabase.supabase
    .from("profiles")
    .select("portal_id")
    .eq("id", req.user.id)
    .single();

  if (error || !profile?.portal_id) {
    return null;
  }

  req.authPortalId = profile.portal_id;
  return profile.portal_id;
};

const fetchUserRoleIds = async (portalId) => {
  const { data: roles, error } = await supabase.supabase
    .from("user_service_roles")
    .select("role_id")
    .eq("portal_id", portalId);

  if (error) {
    return { error, roleIds: [] };
  }

  return { error: null, roleIds: (roles || []).map((r) => r.role_id) };
};

const requireRoles = (allowedRoles) => {
  const allowed = new Set(allowedRoles || []);

  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const portalId = await resolvePortalId(req);
      if (!portalId) {
        return res.status(403).json({
          success: false,
          message: "User profile is missing a portal ID",
        });
      }

      const { error, roleIds } = await fetchUserRoleIds(portalId);
      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to verify user roles",
        });
      }

      const roleValues = new Set(roleIds);
      const hasRole = [...roleValues].some((role) => allowed.has(role));

      if (!hasRole) {
        return res.status(403).json({
          success: false,
          message: "Insufficient permissions",
        });
      }

      req.authRoleIds = [...roleValues];
      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Authorization check failed",
      });
    }
  };
};

const requirePrivilegedRole = requireRoles([...PRIVILEGED_ROLES]);
const requireConfessionAdmin = requireRoles([...CONFESSION_ADMIN_ROLES]);
const requireAnnouncementAdmin = requireRoles([...ANNOUNCEMENT_ADMIN_ROLES]);
const requireServiceAdmin = requireRoles([...SERVICE_ADMIN_ROLES]);
const requireDeaconsSchoolWrite = requireRoles([...DEACONS_SCHOOL_WRITE_ROLES]);

// Roles that can act on any course without being assigned to it
const PRIVILEGED_DS_ROLES = new Set([
  "priest",
  "coordinator",
  "deacon_school_coordinator",
  "deacon_school_principal",
]);

// Ensures a deacon_school_teacher is assigned to the course_id in the request.
// Privileged DS roles bypass the check.
const requireTeacherAssignedToCourse = async (req, res, next) => {
  try {
    const portalId = await resolvePortalId(req);
    if (!portalId) {
      return res.status(403).json({ success: false, message: "User profile is missing a portal ID" });
    }

    const { error, roleIds } = await fetchUserRoleIds(portalId);
    if (error) {
      return res.status(500).json({ success: false, message: "Failed to verify user roles" });
    }

    if (roleIds.some((r) => PRIVILEGED_DS_ROLES.has(r))) return next();

    const courseId = req.body?.course_id || req.params?.course_id || req.params?.courseId;
    if (!courseId) {
      return res.status(400).json({ success: false, message: "course_id is required" });
    }

    const { data, error: assignError } = await supabase.supabase
      .from("ds_course_teachers")
      .select("teacher_id")
      .eq("teacher_id", portalId)
      .eq("course_id", courseId)
      .eq("is_active", true)
      .maybeSingle();

    if (assignError) {
      return res.status(500).json({ success: false, message: "Failed to verify course assignment" });
    }

    if (!data) {
      return res.status(403).json({ success: false, message: "You are not assigned to this course" });
    }

    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: "Authorization check failed" });
  }
};

// Same check for batch score submissions where course_id lives inside each score row.
const requireTeacherAssignedToCourseForBatch = async (req, res, next) => {
  try {
    const portalId = await resolvePortalId(req);
    if (!portalId) {
      return res.status(403).json({ success: false, message: "User profile is missing a portal ID" });
    }

    const { error, roleIds } = await fetchUserRoleIds(portalId);
    if (error) {
      return res.status(500).json({ success: false, message: "Failed to verify user roles" });
    }

    if (roleIds.some((r) => PRIVILEGED_DS_ROLES.has(r))) return next();

    const scores = req.body?.scores;
    if (!Array.isArray(scores) || scores.length === 0) return next();

    const courseIds = [...new Set(scores.map((s) => s?.course_id).filter(Boolean))];
    if (courseIds.length === 0) return next();

    const { data, error: assignError } = await supabase.supabase
      .from("ds_course_teachers")
      .select("course_id")
      .eq("teacher_id", portalId)
      .in("course_id", courseIds)
      .eq("is_active", true);

    if (assignError) {
      return res.status(500).json({ success: false, message: "Failed to verify course assignments" });
    }

    const assignedCourses = new Set((data || []).map((r) => r.course_id));
    const unauthorized = courseIds.filter((id) => !assignedCourses.has(id));

    if (unauthorized.length > 0) {
      return res.status(403).json({
        success: false,
        message: `You are not assigned to course(s): ${unauthorized.join(", ")}`,
      });
    }

    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: "Authorization check failed" });
  }
};

const requirePortalMatchOrRoles = (
  fieldName = "user_id",
  allowedRoles = [],
) => {
  const allowed = new Set(allowedRoles || []);

  return async (req, res, next) => {
    try {
      const portalId = await resolvePortalId(req);
      if (!portalId) {
        return res.status(403).json({
          success: false,
          message: "User profile is missing a portal ID",
        });
      }

      const targetPortalId = req.body?.[fieldName];
      if (!targetPortalId || targetPortalId === portalId) {
        return next();
      }

      const { error, roleIds } = await fetchUserRoleIds(portalId);
      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to verify user roles",
        });
      }

      const hasAllowedRole = roleIds.some((roleId) => allowed.has(roleId));
      if (!hasAllowedRole) {
        return res.status(403).json({
          success: false,
          message: "You can only access your own account",
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Authorization check failed",
      });
    }
  };
};

const requireParamPortalMatchOrRoles = (
  paramName = "userId",
  allowedRoles = [],
) => {
  const allowed = new Set(allowedRoles || []);

  return async (req, res, next) => {
    try {
      const portalId = await resolvePortalId(req);
      if (!portalId) {
        return res.status(403).json({
          success: false,
          message: "User profile is missing a portal ID",
        });
      }

      const targetPortalId = req.params?.[paramName];
      if (!targetPortalId || targetPortalId === portalId) {
        return next();
      }

      const { error, roleIds } = await fetchUserRoleIds(portalId);
      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to verify user roles",
        });
      }

      const hasAllowedRole = roleIds.some((roleId) => allowed.has(roleId));
      if (!hasAllowedRole) {
        return res.status(403).json({
          success: false,
          message: "You can only access your own account",
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Authorization check failed",
      });
    }
  };
};

const requirePortalMatchOrPrivileged = (fieldName = "user_id") => {
  return requirePortalMatchOrRoles(fieldName, [...PRIVILEGED_ROLES]);
};

module.exports = {
  authenticateToken,
  requireRoles,
  requirePrivilegedRole,
  requireConfessionAdmin,
  requireAnnouncementAdmin,
  requireServiceAdmin,
  requireDeaconsSchoolWrite,
  requirePortalMatchOrRoles,
  requireParamPortalMatchOrRoles,
  requirePortalMatchOrPrivileged,
  requireTeacherAssignedToCourse,
  requireTeacherAssignedToCourseForBatch,
};
