// app/auth.js
// ------------------------------------------------------------
// Auth screen logic for Son of Wisdom
// Works with IDs in auth.html and a named export { supabase }
// from /app/supabase.js
// ------------------------------------------------------------
import { supabase } from '/app/supabase.js';

// ------- small DOM helpers -------
const $ = (sel) => document.querySelector(sel);
const statusEl   = $('#status');
const emailEl    = $('#email');
const passEl     = $('#password');
const btnSignIn  = $('#btn-signin');
const linkSignup = $('#link-signup');
const linkForgot = $('#link-forgot');

// ------- status display -------
function setStatus(msg = '', kind = 'info') {
  if (!statusEl) return;
  statusEl.style.display = msg ? 'block' : 'none';
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind; // hook for CSS: [data-kind="ok"], [data-kind="error"], etc.
}

// ------- determine post-login redirect -------
function getRedirectTarget() {
  const qp = new URLSearchParams(location.search);
  return qp.get('redirect') || '/home.html';
}

// ------- show status from URL (e.g. after confirm/reset) -------
(() => {
  const qp = new URLSearchParams(location.search);
  if (qp.get('confirm')) setStatus('Email confirmed. You can sign in now.', 'ok');
  if (qp.get('reset'))   setStatus('Password reset completed. Sign in with your new password.', 'ok');
})();

// ------- guard: already signed in? -------
(async () => {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      location.replace(getRedirectTarget());
      return;
    }
  } catch (e) {
    console.warn('[auth] session check failed', e);
  }
})();

// ------- sign in -------
btnSignIn?.addEventListener('click', async () => {
  const email = (emailEl?.value || '').trim();
  const password = passEl?.value || '';

  if (!email || !password) {
    setStatus('Please enter your email and password.', 'error');
    return;
  }

  btnSignIn.disabled = true;
  setStatus('Signing in…');

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    setStatus('Signed in. Redirecting…', 'ok');
    location.replace(getRedirectTarget());
  } catch (err) {
    setStatus(err?.message || 'Sign in failed. Please try again.', 'error');
  } finally {
    btnSignIn.disabled = false;
  }
});

// ------- sign up (re-uses email + password fields) -------
linkSignup?.addEventListener('click', async (e) => {
  e.preventDefault();
  const email = (emailEl?.value || '').trim();
  const password = passEl?.value || '';
  if (!email || !password) {
    setStatus('Enter email and a password first, then click “Create an account”.', 'info');
    return;
  }

  setStatus('Creating your account…');

  try {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${location.origin}/auth.html?confirm=true&redirect=${encodeURIComponent(getRedirectTarget())}`,
      },
    });
    if (error) throw error;
    setStatus('Check your inbox to confirm your email.', 'ok');
  } catch (err) {
    setStatus(err?.message || 'Sign up failed. Please try again.', 'error');
  }
});

// ------- forgot password -------
linkForgot?.addEventListener('click', async (e) => {
  e.preventDefault();
  const email = (emailEl?.value || '').trim();
  if (!email) {
    setStatus('Type your email first, then click “Forgot password?”.', 'info');
    return;
  }

  setStatus('Sending password reset email…');

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth.html?reset=true&redirect=${encodeURIComponent(getRedirectTarget())}`,
    });
    if (error) throw error;
    setStatus('Password reset email sent. Check your inbox.', 'ok');
  } catch (err) {
    setStatus(err?.message || 'Could not send reset email.', 'error');
  }
});

// ------- toggle password visibility -------
const togglePassword = document.getElementById('toggle-password');

togglePassword?.addEventListener('click', () => {
  if (!passEl) return;
  const isHidden = passEl.type === 'password';
  passEl.type = isHidden ? 'text' : 'password';
  togglePassword.textContent = isHidden ? '🙈' : '👁️';
});

// ------- script ready -------
console.log('[auth] ready');
