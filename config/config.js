const { createClient } = require("@supabase/supabase-js");
const supabaseUrl = "https://oplzcugljytvywvewdkj.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wbHpjdWdsanl0dnl3dmV3ZGtqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwNTUwOTY4OSwiZXhwIjoyMDIxMDg1Njg5fQ.rIcLqb-QOCTC9ApvfeQpoNGrqqmtou-iBR_kLNH6fBs";
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true, // keeps session in memory (frontend only, no effect on Node backend)
    autoRefreshToken: true, // automatically refreshes token (frontend only)
    detectSessionInUrl: true, // frontend use for OAuth redirects
  },
});

module.exports = {
  supabase,
};

module.exports = {
  supabase: supabase,
};
