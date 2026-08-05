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

  // This is a single PROCESS-WIDE client shared by every request. supabase-js
  // resolves the PostgREST Authorization header as
  //   (await this.auth.getSession()).session?.access_token ?? supabaseKey
  // so the moment any route stores a session on it (auth.signInWithPassword in
  // POST /login, auth.verifyOtp, auth.signUp), EVERY subsequent .from() query in
  // the process silently runs as that one logged-in user instead of the service
  // role. On RLS-protected tables with no policies (e.g.
  // ds_registration_requests) that returns [] with HTTP 200 and no error, so it
  // fails invisibly and stays broken until the process restarts.
  //
  // Server-side auth is always per-request — every call site passes an explicit
  // token (auth.getUser(token), auth.refreshSession({refresh_token}), admin.*),
  // so nothing here should ever read an ambient session. Refuse to hand one out
  // and this client stays pinned to the service role no matter what any route
  // does with .auth.
  supabase.auth.getSession = async () => ({
    data: { session: null },
    error: null,
  });

  // supabase-js binds _getAccessToken at construction (SupabaseClient.js), so the
  // getSession stub above is the only seam that works. It resolves the request
  // token as `(await _getAccessToken()) ?? supabaseKey` (lib/fetch.js), so "no
  // session" must surface as null/undefined here. Verify that still holds — if a
  // supabase-js upgrade changes it, fail loudly at boot instead of silently
  // serving empty result sets.
  supabase._getAccessToken().then(
    (token) => {
      if (token != null && token !== supabaseKey) {
        console.error(
          "FATAL: Supabase data client is not pinned to the service-role key. " +
            "RLS-protected tables will silently return empty results. " +
            "Check the getSession stub in config/config.js against the installed supabase-js.",
        );
      }
    },
    () => {
      console.error(
        "FATAL: Could not verify the Supabase data client's access token resolution. " +
          "Check the getSession stub in config/config.js against the installed supabase-js.",
      );
    },
  );

  module.exports = { supabase, port, nodeEnv, isDevelopment, jwtSecret };
}
