import { createBackend } from './backend.js';
import { initializeProfile } from './profile.js';
import { importKalshiKey, fetchKalshiHistory } from './kalshi.js';
import { maxCsvBytes } from './config.js';
import { createAccountStore } from './storage.js';
import { calendarPreferences } from './preferences.js';
import { timeZones, dateFormatter } from './timezone.js';

const el = id => document.getElementById(id);
const profile = initializeProfile();
let backend, user, kalshiKey, kalshiKeyId = '', syncController;
function setSyncBusy(value) {
  for (const id of ['kalshiKeyId', 'kalshiPrivateKey', 'kalshiSyncBtn', 'kalshiDisconnectBtn', 'signOutBtn']) el(id).disabled = value;
}
function forgetKalshi() {
  syncController?.abort();
  kalshiKey = null;
  kalshiKeyId = '';
  el('kalshiKeyId').value = '';
  el('kalshiPrivateKey').value = '';
  el('kalshiPrivateKey').required = true;
  el('kalshiDiagnostics').hidden = true;
  el('kalshiDiagnosticText').value = '';
}
const login = () => {
  forgetKalshi();
  profile.hide();
  el('settingsPage').hidden = true;
  window.location.replace(new URL('./auth/', document.baseURI));
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
    setSyncBusy(false);
    if (window.location.hash === '#kalshiPanel') el('kalshiPanel').scrollIntoView();
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

el('kalshiDisconnectBtn').addEventListener('click', () => {
  forgetKalshi();
  el('kalshiStatus').textContent = 'Credentials forgotten. Imported data remains saved to your account.';
});
el('copyKalshiDiagnostics').addEventListener('click', async () => {
  const field = el('kalshiDiagnosticText');
  try {
    await navigator.clipboard.writeText(field.value);
    el('kalshiStatus').textContent = 'Diagnostics copied.';
  } catch {
    field.focus(); field.select();
    el('kalshiStatus').textContent = 'Diagnostics selected. Press Command+C on Mac or Ctrl+C on Windows to copy them.';
  }
});
el('kalshiForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!user || syncController) return;
  const keyId = el('kalshiKeyId').value.trim();
  const controller = new AbortController();
  syncController = controller;
  setSyncBusy(true);
  el('kalshiStatus').textContent = 'Connecting to Kalshi…';
  el('kalshiDiagnostics').hidden = true;
  el('kalshiDiagnosticText').value = '';
  try {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(keyId)) throw new Error('Enter a valid API key ID.');
    let key = kalshiKey;
    if (el('kalshiPrivateKey').value.trim()) key = await importKalshiKey(el('kalshiPrivateKey').value);
    else if (keyId !== kalshiKeyId) throw new Error('Enter the private key that belongs to this key ID.');
    if (!key) throw new Error('Enter your Kalshi private key.');
    kalshiKey = key; kalshiKeyId = keyId;
    el('kalshiPrivateKey').value = '';
    el('kalshiPrivateKey').required = false;
    const csv = await fetchKalshiHistory(backend, keyId, key, message => { el('kalshiStatus').textContent = message; }, controller.signal);
    if (new Blob([csv]).size > maxCsvBytes) throw new Error('Imported history exceeds the 2 MB account limit.');
    const store = createAccountStore(backend, user.id);
    const previous = await store.load();
    await store.save({ csv, filename: `Kalshi API · FIFO estimate · synced ${new Date().toISOString()}`, timeZone: calendarPreferences(user, previous?.timeZone).timeZone });
    window.location.assign(new URL('./dashboard/', document.baseURI));
  } catch (error) {
    el('kalshiStatus').textContent = `Could not sync: ${error.message}`;
    if (error.diagnostic) {
      el('kalshiDiagnosticText').value = JSON.stringify(error.diagnostic, null, 2);
      el('kalshiDiagnostics').hidden = false;
    }
  } finally {
    syncController = null;
    setSyncBusy(false);
  }
});
window.addEventListener('pagehide', forgetKalshi);

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
