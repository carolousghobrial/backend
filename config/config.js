const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const port = process.env.PORT || "3000";
const nodeEnv = process.env.NODE_ENV || "development";
const isDevelopment = nodeEnv === "development";

const jwtSecret = process.env.JWT_SECRET;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

const missingVars = [];
if (!supabaseUrl) missingVars.push("SUPABASE_URL");
if (!supabaseKey)
  missingVars.push("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)");
if (!jwtSecret) missingVars.push("JWT_SECRET");
if (missingVars.length > 0) {
  console.warn(
    `Missing environment variables: ${missingVars.join(", ")}. Routes depending on these will fail at runtime.`,
  );
}

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "Supabase environment variables not set. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) to enable DB access.",
  );

  // Export a proxy that throws when any property is accessed to avoid crashing the app
  // at module load time while still providing a clear runtime error when DB is used.
  const supabaseProxy = new Proxy(
    {},
    {
      get() {
        throw new Error(
          "Supabase client not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) in your environment.",
        );
      },
      apply() {
        throw new Error(
          "Supabase client not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) in your environment.",
        );
      },
    },
  );

  module.exports = {
    supabase: supabaseProxy,
    port,
    nodeEnv,
    isDevelopment,
    jwtSecret,
  };
} else {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  module.exports = { supabase, port, nodeEnv, isDevelopment, jwtSecret };
}
