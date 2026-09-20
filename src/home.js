import { createBackend } from './backend.js';

async function initialize() {
  try {
    const backend = createBackend();
    if (!backend) return;
    async function redirectIfSignedIn() {
      const { data, error } = await backend.auth.getSession();
      if (error || !data.session) return;
      const { data: verified, error: verificationError } = await backend.auth.getUser();
      if (!verificationError && verified.user) window.location.replace(new URL('./dashboard.html', window.location.href));
    }
    backend.auth.onAuthStateChange((_event, session) => {
      if (session) setTimeout(() => redirectIfSignedIn().catch(() => {}), 0);
    });
    await redirectIfSignedIn();
  } catch { /* Keep the public homepage usable if authentication is unavailable. */ }
}
initialize();
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
