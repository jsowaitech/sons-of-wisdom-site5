// app/finish-signup.js
// Handles "finish sign up" + "reset password" after the user clicks their email link.
// - Confirms the Supabase session from the link
// - Lets the user choose a password
// - Signs them out and sends them back to auth.html to sign in

import { supabase } from "./supabase.js";

// Same origin logic as auth.js
const DEV_FALLBACK_ORIGIN = "https://wonderful-swan-01729a.netlify.app";

function getAuthOrigin() {
  const origin = window.location.origin;
  if (origin && origin.startsWith("http")) return origin;
  return DEV_FALLBACK_ORIGIN;
}

// DOM
const statusEl = document.getElementById("status");
const titleEl = document.getElementById("auth-card-title");
const subEl = document.getElementById("auth-card-sub");

// Reuse the same IDs that the old set-password view used
const setpwEmailLine = document.getElementById("setpw-email-line");
const setpwEmailSpan = document.getElementById("user-email");
const setpwForm = document.getElementById("set-password-form");
const setpwPassEl = document.getElementById("sp-password");
const setpwPassConfEl = document.getElementById("sp-password-confirm");
const btnSetPassword = document.getElementById("btn-set-password");
const setpwSigninLink = document.getElementById("setpw-signin-link");

const params = new URLSearchParams(window.location.search);

// ---------- helpers ----------
function setStatus(message, kind = "info") {
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.style.display = message ? "block" : "none";
  statusEl.dataset.kind = kind;
}

function setCopyFromContext() {
  const from = params.get("from") || "signup";
  if (!titleEl || !subEl) return;

  if (from === "recovery") {
    titleEl.textContent = "Reset your password";
    subEl.textContent =
      "You opened a password reset link. Choose a new password for your account.";
  } else {
    titleEl.textContent = "Create your password";
    subEl.textContent =
      "Your email is confirmed. Now choose a password for your Son of Wisdom account.";
  }
}

// ---------- boot: validate link + show email ----------
async function boot() {
  setCopyFromContext();
  setStatus("Checking your link…", "info");

  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    console.warn("[finish-signup] no user for this link", error);
    setStatus(
      "This link is invalid or has expired. Please request a new one from the app.",
      "error"
    );
    if (btnSetPassword) btnSetPassword.disabled = true;
    if (setpwForm) setpwForm.style.opacity = "0.6";
    if (setpwSigninLink) setpwSigninLink.style.display = "block";
    return;
  }

  const email = data.user.email;
  if (email && setpwEmailSpan) {
    setpwEmailSpan.textContent = email;
    if (setpwEmailLine) setpwEmailLine.style.display = "block";
  }

  setStatus("", "info");
}

// ---------- submit: save password ----------
setpwForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pwd = (setpwPassEl?.value || "").trim();
  const confirm = (setpwPassConfEl?.value || "").trim();

  if (!pwd || !confirm) {
    setStatus("Please enter your new password twice.", "error");
    return;
  }
  if (pwd.length < 8) {
    setStatus("Password must be at least 8 characters long.", "error");
    return;
  }
  if (pwd !== confirm) {
    setStatus("Passwords do not match.", "error");
    return;
  }

  if (btnSetPassword) btnSetPassword.disabled = true;
  setStatus("Saving your password…", "info");

  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      setStatus(
        "Your session is no longer valid. Please open the email link again.",
        "error"
      );
      if (btnSetPassword) btnSetPassword.disabled = false;
      if (setpwSigninLink) setpwSigninLink.style.display = "block";
      return;
    }

    const email = userData.user.email;

    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) {
      console.error("[finish-signup] updateUser error", error);
      setStatus(error.message || "Could not update password.", "error");
      if (btnSetPassword) btnSetPassword.disabled = false;
      return;
    }

    setStatus("Password saved. Redirecting you to sign in…", "success");

    // End the special email-link session and send them to normal login
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("[finish-signup] signOut error", err);
    }

    const origin = getAuthOrigin();
    const url = new URL("auth.html", origin);
    url.searchParams.set("mode", "signin");
    if (email) url.searchParams.set("email", email);
    url.searchParams.set("password_set", "1");
    window.location.href = url.toString();
  } catch (err) {
    console.error("[finish-signup] unexpected set-password error", err);
    setStatus("Unexpected error updating password.", "error");
    if (btnSetPassword) btnSetPassword.disabled = false;
  }
});

// ---------- start ----------
boot().catch((err) => {
  console.error("[finish-signup] boot error", err);
  setStatus("Something went wrong loading this page.", "error");
});

console.log("[finish-signup] ready");
