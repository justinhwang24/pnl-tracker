import { aggregateTrades } from "./analytics.js";

export function parseCSV(text) {
  // Handles ordinary CSV including quoted commas.
  const rows = [];
  let row=[], field="", inQuotes=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c === '"') {
      if(inQuotes && text[i+1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if(c === ',' && !inQuotes) {
      row.push(field); field="";
    } else if((c === '\n' || c === '\r') && !inQuotes) {
      if(c==='\r' && text[i+1]==='\n') i++;
      row.push(field); field="";
      if(row.some(x=>x!=='')) rows.push(row);
      row=[];
    } else {
      field += c;
    }
  }
  if(field.length || row.length) { row.push(field); rows.push(row); }
  if (inQuotes) throw new Error("CSV contains an unclosed quoted field.");
  return rows;
}

// Keep individual closes so timezone changes and trade statistics use source rows.
export function parseKalshiCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("CSV has no data rows.");
  const headers = rows[0].map(s => s.trim());
  const iPnl = headers.indexOf("realized_pnl_with_fees_dollars");
  const iClose = headers.indexOf("close_timestamp");
  if (iPnl < 0 || iClose < 0) throw new Error("CSV must contain realized_pnl_with_fees_dollars and close_timestamp.");

  const trades = [];
  let snapshot = null;
  const issues = {};
  try {
    const savedIssues = JSON.parse(rows[1]?.[headers.indexOf('sync_issues')] || '{}');
    for (const key of ['balance', 'markets']) {
      if (typeof savedIssues?.[key] === 'string') issues[key] = savedIssues[key].slice(0, 1000);
    }
  } catch { /* Optional import warnings may be absent in older CSVs. */ }
  const snapshotRaw = rows[1]?.[headers.indexOf('account_snapshot')];
  if (snapshotRaw) {
    try {
      const value = JSON.parse(snapshotRaw);
      if (['cash', 'positions', 'fetchedAt', 'historyCutoff'].every(key => Number.isFinite(value[key]) && value[key] >= 0) &&
          value.fetchedAt > 0 && value.historyCutoff > 0 && value.historyCutoff <= value.fetchedAt) snapshot = value;
    } catch { /* Optional metadata never invalidates trade rows. */ }
  }
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const timestamp = row[iClose]?.trim() || "";
    const rawPnl = row[iPnl]?.trim() || "";
    const pnl = Number(rawPnl);
    // Require an explicit offset: never interpret an ambiguous time in the viewer's timezone.
    const validTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
    const closedAt = Date.parse(timestamp);
    if (!validTimestamp || !Number.isFinite(closedAt) || !rawPnl || !Number.isFinite(pnl)) {
      skipped++;
      continue;
    }
    const trade = { closedAt, pnl };
    for (const [column, field] of [['entry_cost_dollars', 'cost'], ['quantity', 'quantity']]) {
      const raw = row[headers.indexOf(column)]?.trim();
      if (raw && Number.isFinite(Number(raw)) && Number(raw) > 0) trade[field] = Number(raw);
    }
    const ticker = row[headers.indexOf('ticker')]?.trim();
    if (ticker) trade.ticker = ticker;
    const title = row[headers.indexOf('market_title')]?.trim();
    if (title) trade.title = title;
    const side = row[headers.indexOf('side')]?.trim().toLowerCase();
    if (['yes', 'no'].includes(side)) trade.side = side;
    const closeType = row[headers.indexOf('close_type')]?.trim();
    if (['sale', 'settlement'].includes(closeType)) trade.closeType = closeType;
    trades.push(trade);
  }
  if (!trades.length) throw new Error("CSV has no valid closed trades with P&L and timezone-aware timestamps.");
  return { trades, skipped, snapshot, issues };
}

// Convenience helper for consumers that only need daily P&L.
export function loadKalshiCSV(text, timeZone = 'UTC') {
  return aggregateTrades(parseKalshiCSV(text).trades, timeZone).pnlByDate;
}
