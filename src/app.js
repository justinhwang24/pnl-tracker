import { calendarPreferences } from './preferences.js';
import { initializeProfile } from './profile.js';
import { parseKalshiCSV } from './csv.js';
import { newestMonth, monthEntries } from './pnl.js';
import { aggregateTrades, monthlyTrades } from './analytics.js';
import { defaultTimeZone, dateFormatter, dateInZone } from './timezone.js';
import { createAccountStore } from './storage.js';
import { createBackend } from './backend.js';
import { maxCsvBytes } from './config.js';
import { renderCalendar } from './views/calendar.js';
import { renderYearCalendar } from './views/year.js';
import { renderStats } from './views/stats.js';
import { renderTable } from './views/table.js';
import { renderChart } from './views/chart.js';

const el = id => document.getElementById(id);
const profile = initializeProfile();
let trades = [], skipped = 0;
let record = { csv: '', filename: '', timeZone: defaultTimeZone() };
let currentMonth;
let viewMode = 'month';
let backend = null, user = null, store = null;
let generation = 0, busy = false, identity;
function updateSyncButton() {
  const connected = record.filename.startsWith('Kalshi API');
  el('connectKalshiBtn').hidden = connected;
  el('refreshKalshiBtn').hidden = !connected;
}

function status(message, error = false) {
  el('status').textContent = message;
  el('status').className = `status${error ? ' neg' : ''}`;
  el('accountStatus').hidden = !error;
}

function setBusy(value) {
  busy = value;
  for (const id of ['csvFile', 'saveBtn', 'signOutBtn', 'refreshKalshiBtn']) {
    el(id).disabled = value;
  }
  updateSyncButton();
}

function render(resetMonth = false) {
  const { pnlByDate, countsByDate, datedTrades } = aggregateTrades(trades, record.timeZone);
  if (resetMonth || !currentMonth) {
    const today = dateInZone(Date.now(), dateFormatter(record.timeZone));
    currentMonth = newestMonth(Object.keys(pnlByDate).length ? pnlByDate : { [today]: 0 });
  }
  const year = currentMonth.getFullYear();
  const entries = viewMode === 'year'
    ? Object.entries(pnlByDate).filter(([date]) => date.startsWith(`${year}-`)).sort(([a], [b]) => a.localeCompare(b))
    : monthEntries(pnlByDate, currentMonth);
  const periodTrades = viewMode === 'year'
    ? datedTrades.filter(item => item.date.startsWith(`${year}-`))
    : monthlyTrades(datedTrades, currentMonth);
  el('monthViewBtn').setAttribute('aria-pressed', String(viewMode === 'month'));
  el('yearViewBtn').setAttribute('aria-pressed', String(viewMode === 'year'));
  el('pnlLabel').textContent = viewMode === 'year' ? 'Year P&L' : 'Month P&L';
  el('prevMonth').setAttribute('aria-label', viewMode === 'year' ? 'Previous year' : 'Previous month');
  el('nextMonth').setAttribute('aria-label', viewMode === 'year' ? 'Next year' : 'Next month');
  if (viewMode === 'year') renderYearCalendar(pnlByDate, countsByDate, year, calendarPreferences(user, record.timeZone), month => {
    currentMonth = new Date(year, month, 1);
    viewMode = 'month';
    render();
  });
  else renderCalendar(pnlByDate, currentMonth, countsByDate, calendarPreferences(user, record.timeZone));
  renderStats(periodTrades);
  renderTable(entries, countsByDate);
  renderChart(entries, viewMode);
  updateSyncButton();
}

function applyRecord(next) {
  const parsed = next?.csv ? parseKalshiCSV(next.csv) : { trades: [], skipped: 0 };
  const nextRecord = next || { csv: '', filename: '', timeZone: defaultTimeZone() };
  record = { ...nextRecord, timeZone: calendarPreferences(user, nextRecord.timeZone).timeZone };
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
    status('Saved to your account.');
  } catch (error) {
    if (version !== generation) return;
    el('saveBtn').hidden = false;
    status(`Changes are displayed but not saved: ${error.message}`, true);
  }
}

async function switchUser(nextUser, force = false) {
  if (!nextUser) {
    profile.hide();
    ++generation;
    setBusy(true);
    document.getElementById('dashboard').hidden = true;
    applyRecord(null);
    window.location.replace(new URL('./auth/', document.baseURI));
    return;
  }
  const nextIdentity = nextUser.id;
  if (!force && identity === nextIdentity) return;
  identity = nextIdentity;
  const version = ++generation;
  user = nextUser;
  setBusy(true);
  el('saveBtn').hidden = true;
  el('reloadBtn').hidden = true;
  el('csvFile').value = '';
  applyRecord(null); // Never leave a previous user's CSV visible while loading.
  profile.show();
  status('Loading saved data…');
  try {
    store = createAccountStore(backend, user.id);
    const saved = await store.load();
    if (version !== generation) return;
    applyRecord(saved);
    status(saved ? 'Restored your latest account upload.' : 'Connect Kalshi or upload a CSV to begin.');
  } catch (error) {
    if (version !== generation) return;
    status(`Could not load saved data: ${error.message}`, true);
    el('reloadBtn').hidden = false;
  } finally {
    if (version === generation) setBusy(false);
  }
}

render();
setBusy(true);

el('refreshKalshiBtn').addEventListener('click', () => {
  if (!busy) window.location.assign(new URL('./settings/#kalshiPanel', document.baseURI));
});

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

el('saveBtn').addEventListener('click', async () => {
  const version = generation;
  setBusy(true);
  await save();
  if (version === generation) setBusy(false);
});
el('reloadBtn').addEventListener('click', () => switchUser(user, true));
for (const [id, delta] of [['prevMonth', -1], ['nextMonth', 1]]) {
  el(id).addEventListener('click', () => {
    currentMonth = viewMode === 'year'
      ? new Date(currentMonth.getFullYear() + delta, currentMonth.getMonth(), 1)
      : new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
    render();
  });
}
el('monthViewBtn').addEventListener('click', () => { viewMode = 'month'; render(); });
el('yearViewBtn').addEventListener('click', () => { viewMode = 'year'; render(); });

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
    if (!backend) { await switchUser(null); return; }
    const callback = new URLSearchParams(window.location.hash.slice(1));
    if (callback.has('error')) {
      const reason = callback.get('error_code') === 'otp_expired' ? 'link_expired' : 'sign_in_failed';
      window.location.replace(new URL(`./auth/?error=${reason}`, document.baseURI));
      return;
    }
    const { data: sessionData, error: sessionError } = await backend.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) { await switchUser(null); return; }
    const { data, error } = await backend.auth.getUser();
    if (error || !data.user) { await switchUser(null); return; }
    if (window.location.pathname.endsWith('/dashboard.html')) window.history.replaceState(null, '', new URL('./dashboard/', document.baseURI));
    backend.auth.onAuthStateChange((_event, session) => {
      // Keep database requests outside the auth callback's lock.
      setTimeout(() => switchUser(session?.user || null), 0);
    });
    el('authGate').hidden = true;
    el('dashboard').hidden = false;
    await switchUser(data.user);
  } catch (error) {
    el('gateStatus').textContent = `Could not verify your session: ${error.message}. Reload to retry.`;
  }
}
initialize();

window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
