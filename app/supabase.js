// app/supabase.js
// Tiny, loop-safe auth helpers.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// --------------- ENV -----------------
const SUPABASE_URL  = window.SUPABASE_URL  || "https://plrobtlpedniyvkpwdmp.supabase.co";
const SUPABASE_ANON = window.SUPABASE_ANON || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBscm9idGxwZWRuaXl2a3B3ZG1wIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjYyOTg1MCwiZXhwIjoyMDYyMjA1ODUwfQ.IhY398suDk3RKXAAgyO5FM6Wr8SbkDyd8bE8pql6nSE";
// -------------------------------------

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

/**
 * Use on protected pages (e.g., home.html).
 * If unauthenticated, redirect to auth.html with a return URL.
 * Never redirect when you're already on auth.html (prevents loops).
 */
export async function ensureAuthedOrRedirect() {
  const session = await getSession();
  if (session) return session;

  const here = new URL(window.location.href);
  if (here.pathname.endsWith("/auth.html")) return null; // don't bounce on auth page

  const dest = `/auth.html?redirect=${encodeURIComponent(
    here.pathname + here.search
  )}`;
  window.location.replace(dest);
  return null;
}
