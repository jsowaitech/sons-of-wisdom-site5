// supabase.js
// Shared Supabase client for Son of Wisdom (browser-safe)

// IMPORTANT:
// 1) Use the *anon* public key here, NOT the service role key.
// 2) Keep this file in the same folder as auth.html, home.html, etc.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- Your project settings ----
const SUPABASE_URL = "https://plrobtlpedniyvkpwdmp.supabase.co";

// Put your **anon** public key below (NOT the service_role key)
const SUPABASE_ANON_KEY =
  window.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBscm9idGxwZWRuaXl2a3B3ZG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY2Mjk4NTAsImV4cCI6MjA2MjIwNTg1MH0.7jK32FivCUTXnzG7sOQ9oYUyoJa4OEjMIuNN4eRr-UA";

// Basic guard so auth.js doesn’t blow up silently
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY. " +
      "Check supabase.js configuration."
  );
}

// Create the client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// For quick debugging in the console
window.__supabase = supabase;
console.log("[supabase] client initialised");
