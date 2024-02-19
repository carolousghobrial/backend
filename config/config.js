const { createClient } = require("@supabase/supabase-js");
const supabaseUrl = "https://oplzcugljytvywvewdkj.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wbHpjdWdsanl0dnl3dmV3ZGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDU1MDk2ODksImV4cCI6MjAyMTA4NTY4OX0.rqORHVh8Scw_1zQ8F7zael9gJrnZ7U63gOqTA325hQU";
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = {
  supabase: supabase,
};
