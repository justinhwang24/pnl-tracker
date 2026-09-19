import { parseKalshiCSV } from './csv.js';
import { newestMonth, monthEntries } from './pnl.js';
import { aggregateTrades, monthlyTrades } from './analytics.js';
import { defaultTimeZone, timeZones, dateFormatter, dateInZone } from './timezone.js';
import { createGuestStore, createAccountStore } from './storage.js';
import { createBackend } from './backend.js';
import { maxCsvBytes } from './config.js';
import { renderCalendar } from './views/calendar.js';
import { renderStats } from './views/stats.js';
import { renderTable } from './views/table.js';
import { renderChart } from './views/chart.js';

const el = id => document.getElementById(id);
let trades = [], skipped = 0;
let record = { csv: '', filename: '', timeZone: defaultTimeZone() };
let currentMonth;
let backend = null, user = null, store = null;
let generation = 0, busy = false, identity;

function status(message, error = false) {
  el('status').textContent = message;
  el('status').className = `status${error ? ' neg' : ''}`;
}

function setBusy(value) {
  busy = value;
  for (const id of ['csvFile', 'resetBtn', 'timeZone', 'saveBtn', 'signOutBtn', 'signInBtn']) {
    el(id).disabled = value;
  }
  el('uploadLabel').classList.toggle('disabled', value);
}

function setTimeZone(value) {
  dateFormatter(value); // Validate saved preferences before applying them.
  if (![...el('timeZone').options].some(option => option.value === value)) {
    el('timeZone').add(new Option(value.replaceAll('_', ' '), value));
  }
  el('timeZone').value = value;
}

function render(resetMonth = false) {
  const { pnlByDate, countsByDate, datedTrades } = aggregateTrades(trades, record.timeZone);
  if (resetMonth || !currentMonth) {
    const today = dateInZone(Date.now(), dateFormatter(record.timeZone));
    currentMonth = newestMonth(Object.keys(pnlByDate).length ? pnlByDate : { [today]: 0 });
  }
  const entries = monthEntries(pnlByDate, currentMonth);
  renderCalendar(pnlByDate, currentMonth, countsByDate);
  renderStats(monthlyTrades(datedTrades, currentMonth));
  renderTable(entries, countsByDate);
  renderChart(entries);
  el('fileInfo').textContent = record.filename
    ? `${record.filename} · ${trades.length.toLocaleString()} closed trades${skipped ? ` · ${skipped} invalid rows skipped` : ''}`
    : 'No CSV uploaded. Choose a file to get started.';
}

function applyRecord(next) {
  const parsed = next?.csv ? parseKalshiCSV(next.csv) : { trades: [], skipped: 0 };
  const nextRecord = next || { csv: '', filename: '', timeZone: defaultTimeZone() };
  setTimeZone(nextRecord.timeZone);
  record = nextRecord;
  trades = parsed.trades;
  skipped = parsed.skipped;
  render(true);
}

async function save() {
  const version = generation;
  const currentStore = store;
  el('saveBtn').hidden = true;
  try {
    await currentStore.save(record);
    if (version !== generation) return;
    status(user ? 'Saved to your account.' : 'Saved in this browser. Sign in to save across devices.');
  } catch (error) {
    if (version !== generation) return;
    el('saveBtn').hidden = false;
    status(`Changes are displayed but not saved: ${error.message}`, true);
  }
}

async function switchUser(nextUser, force = false) {
  const nextIdentity = nextUser?.id || 'guest';
  if (!force && identity === nextIdentity) return;
  identity = nextIdentity;
  const version = ++generation;
  user = nextUser;
  setBusy(true);
  el('saveBtn').hidden = true;
  el('reloadBtn').hidden = true;
  el('csvFile').value = '';
  applyRecord(null); // Never leave a previous user's CSV visible while loading.
  el('accountInfo').textContent = user ? `Signed in as ${user.email}` : 'Guest · data stays in this browser';
  el('signOutBtn').hidden = !user;
  el('signInForm').hidden = !!user || !backend;
  el('authStatus').textContent = '';
  status('Loading saved data…');
  try {
    store = user ? createAccountStore(backend, user.id) : createGuestStore(window.localStorage);
    const saved = await store.load();
    if (version !== generation) return;
    applyRecord(saved);
    status(saved ? (user ? 'Restored your latest account upload.' : 'Restored your latest browser upload.') : 'Upload a CSV to begin.');
  } catch (error) {
    if (version !== generation) return;
    status(`Could not load saved data: ${error.message}`, true);
    el('reloadBtn').hidden = false;
  } finally {
    if (version === generation) setBusy(false);
  }
}

for (const zone of timeZones()) el('timeZone').add(new Option(zone.replaceAll('_', ' '), zone));
setTimeZone(record.timeZone);
render();
setBusy(true);

el('csvFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || busy) return;
  const version = generation;
  setBusy(true);
  try {
    if (file.size > maxCsvBytes) throw new Error('Choose a CSV smaller than 2 MB.');
    const csv = await file.text();
    if (version !== generation) return;
    applyRecord({ csv, filename: file.name, timeZone: record.timeZone });
    status('Saving your upload…');
    await save();
  } catch (error) {
    if (version === generation) status(`Could not import CSV: ${error.message}`, true);
  } finally {
    if (version === generation) { event.target.value = ''; setBusy(false); }
  }
});

el('timeZone').addEventListener('change', async event => {
  if (busy) return;
  const version = generation;
  setBusy(true);
  record = { ...record, timeZone: event.target.value };
  render(true);
  await save();
  if (version === generation) setBusy(false);
});

el('resetBtn').addEventListener('click', async () => {
  if (busy) return;
  const version = generation;
  setBusy(true);
  try {
    await store.clear();
    if (version !== generation) return;
    applyRecord(null);
    el('csvFile').value = '';
    el('saveBtn').hidden = true;
    el('reloadBtn').hidden = true;
    status('Saved CSV cleared.');
  } catch (error) {
    if (version === generation) status(`Could not clear saved data: ${error.message}`, true);
  } finally {
    if (version === generation) setBusy(false);
  }
});

el('saveBtn').addEventListener('click', async () => {
  const version = generation;
  setBusy(true);
  await save();
  if (version === generation) setBusy(false);
});
el('reloadBtn').addEventListener('click', () => switchUser(user, true));
for (const [id, delta] of [['prevMonth', -1], ['nextMonth', 1]]) {
  el(id).addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
    render();
  });
}

el('signInForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !backend) return;
  el('signInBtn').disabled = true;
  try {
    const redirect = new URL('./', window.location.href).href;
    const { error } = await backend.auth.signInWithOtp({
      email: el('email').value.trim(), options: { emailRedirectTo: redirect },
    });
    if (error) throw error;
    el('authStatus').textContent = 'Check your email for a sign-in link. Open it to create or access your account.';
  } catch (error) {
    el('authStatus').textContent = `Could not send sign-in link: ${error.message}`;
  } finally { el('signInBtn').disabled = busy; }
});

el('signOutBtn').addEventListener('click', async () => {
  if (busy || !backend) return;
  el('signOutBtn').disabled = true;
  const { error } = await backend.auth.signOut({ scope: 'local' });
  if (error) { status(`Could not sign out: ${error.message}`, true); el('signOutBtn').disabled = false; }
  else await switchUser(null);
});

async function initialize() {
  try {
    backend = createBackend();
    el('cloudUnavailable').hidden = !!backend;
    if (!backend) { await switchUser(null); return; }
    const { data, error } = await backend.auth.getSession();
    if (error) throw error;
    backend.auth.onAuthStateChange((_event, session) => {
      // Keep database requests outside the auth callback's lock.
      setTimeout(() => switchUser(session?.user || null), 0);
    });
    await switchUser(data.session?.user || null);
  } catch (error) {
    status(`Accounts could not initialize: ${error.message}. Reload to retry.`, true);
  }
}
initialize();
