import { createBackend } from './backend.js';
import { supabaseUrl, supabasePublishableKey } from './config.js';

const form = document.getElementById('signInForm');
const button = document.getElementById('signInBtn');
const googleButton = document.getElementById('googleSignInBtn');
const status = document.getElementById('authStatus');
const dashboard = new URL('./dashboard.html', window.location.href).href;
let backend;

async function initialize() {
  try {
    backend = createBackend();
    if (!backend) {
      form.hidden = true;
      status.textContent = 'Sign-in is not configured. Please try again later.';
      return;
    }
    const { data, error } = await backend.auth.getSession();
    if (error) throw error;
    if (data.session) {
      const { data: verified, error: verificationError } = await backend.auth.getUser();
      if (!verificationError && verified.user) { window.location.replace(dashboard); return; }
      await backend.auth.signOut({ scope: 'local' });
    }
    backend.auth.onAuthStateChange((_event, session) => {
      if (session) window.location.replace(dashboard);
    });
    if (new URLSearchParams(window.location.search).has('error')) {
      status.textContent = new URLSearchParams(window.location.search).get('error') === 'link_expired'
        ? 'Your sign-in link is invalid or expired. Request a new link below.'
        : 'Sign-in was canceled or could not complete. Try Google again or use an email link.';
      window.history.replaceState(null, '', window.location.pathname);
    }
    button.disabled = false;
    googleButton.disabled = false;
  } catch (error) {
    status.textContent = `Sign-in could not initialize: ${error.message}. Reload to retry.`;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!backend || button.disabled) return;
  button.disabled = true;
  googleButton.disabled = true;
  status.textContent = 'Sending your link…';
  try {
    const { error } = await backend.auth.signInWithOtp({
      email: document.getElementById('email').value.trim(),
      options: { emailRedirectTo: dashboard },
    });
    if (error) throw error;
    status.textContent = 'Check your email for a sign-in link. Open it to create or access your account.';
    button.textContent = 'Send another link';
  } catch (error) {
    status.textContent = `Could not send sign-in link: ${error.message}`;
  } finally { button.disabled = false; googleButton.disabled = false; }
});

googleButton.addEventListener('click', async () => {
  if (!backend || googleButton.disabled) return;
  googleButton.disabled = true;
  button.disabled = true;
  status.textContent = 'Connecting to Google…';
  try {
    // Keep a disabled provider from sending visitors to a raw Supabase error page.
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Could not connect to sign-in. Please try again.');
    const settings = await response.json();
    if (!settings.external?.google) throw new Error('Google sign-in is not available yet. Please use an email link for now.');
    const { data, error } = await backend.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: dashboard, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new Error('Could not start Google sign-in. Please try again.');
    window.location.assign(data.url);
  } catch (error) {
    status.textContent = error.message;
    googleButton.disabled = false;
    button.disabled = false;
  }
});
initialize();
