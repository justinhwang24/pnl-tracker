import { createBackend } from './backend.js';
import { initializeProfile } from './profile.js';
import { createAccountStore } from './storage.js';
import { calendarPreferences } from './preferences.js';
import { timeZones, dateFormatter } from './timezone.js';

const el = id => document.getElementById(id);
const profile = initializeProfile();
let backend, user;
const login = () => {
  profile.hide();
  el('settingsPage').hidden = true;
  window.location.replace(new URL('./auth.html', window.location.href));
};

async function initialize() {
  try {
    backend = createBackend();
    if (!backend) { login(); return; }
    const { data: session, error: sessionError } = await backend.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session.session) { login(); return; }
    const { data, error } = await backend.auth.getUser();
    if (error || !data.user) { login(); return; }
    user = data.user;
    profile.show();
    backend.auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.id !== user.id) login();
    });
    // Preserve the timezone of uploads made before account preferences existed.
    let fallback;
    if (!user.user_metadata?.calendar_preferences?.timeZone) {
      const record = await createAccountStore(backend, user.id).load();
      fallback = record?.timeZone;
    }
    const preferences = calendarPreferences(user, fallback);
    const zones = new Set([...timeZones(), preferences.timeZone]);
    for (const zone of zones) el('timeZone').add(new Option(zone.replaceAll('_', ' '), zone));
    el('timeZone').value = preferences.timeZone;
    el('showTrades').checked = preferences.showTrades;
    el('rounding').checked = preferences.rounding;
    el('weekStart').value = preferences.weekStart;
    el('authGate').hidden = true;
    el('settingsPage').hidden = false;
  } catch (error) {
    el('gateStatus').textContent = `Could not load settings: ${error.message}. Reload to retry.`;
  }
}

el('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!user || el('saveSettings').disabled) return;
  const preferences = {
    timeZone: el('timeZone').value,
    showTrades: el('showTrades').checked,
    rounding: el('rounding').checked,
    weekStart: Number(el('weekStart').value),
  };
  el('settingsFields').disabled = true;
  el('settingsStatus').textContent = 'Saving settings…';
  try {
    dateFormatter(preferences.timeZone);
    const { error } = await backend.auth.updateUser({ data: { calendar_preferences: preferences } });
    if (error) throw error;
    el('settingsStatus').textContent = 'Settings saved to your account.';
  } catch (error) {
    el('settingsStatus').textContent = `Could not save settings: ${error.message}. Please try again.`;
  } finally { el('settingsFields').disabled = false; }
});
initialize();

el('signOutBtn').addEventListener('click', async () => {
  if (!backend) return;
  el('signOutBtn').disabled = true;
  try {
    const { error } = await backend.auth.signOut({ scope: 'local' });
    if (error) throw error;
    login();
  } catch (error) {
    el('settingsStatus').textContent = `Could not sign out: ${error.message}`;
    el('signOutBtn').disabled = false;
  }
});
