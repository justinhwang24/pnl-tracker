import { parseCSV, parseKalshiCSV } from './csv.js';

// Keys are imported as non-extractable and are never sent to the backend.
function sequence(bytes) {
  const size = bytes.length;
  const length = size < 128 ? [size] : size < 256 ? [0x81, size] : [0x82, size >> 8, size & 255];
  return new Uint8Array([0x30, ...length, ...bytes]);
}
export async function importKalshiKey(pem) {
  const match = pem.trim().match(/^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s*([A-Za-z0-9+/=\s]+)\s*-----END \1-----$/);
  if (!match || pem.length > 20000) throw new Error('Enter an unencrypted RSA private key in PEM format.');
  try {
    let bytes = Uint8Array.from(atob(match[2].replace(/\s/g, '')), c => c.charCodeAt(0));
    if (match[1] === 'RSA PRIVATE KEY') {
      // Wrap PKCS#1 in PKCS#8 for Web Crypto.
      const octet = sequence(bytes); octet[0] = 0x04;
      bytes = sequence(new Uint8Array([2, 1, 0, 0x30, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0, ...octet]));
    }
    return await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign']);
  } catch { throw new Error('Could not read the private key. Use the complete RSA key downloaded from Kalshi.'); }
}
export async function signedHeaders(keyId, key, path, timestamp = String(Date.now())) {
  const signature = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key,
    new TextEncoder().encode(`${timestamp}GET${path.split('?')[0]}`));
  return { keyId, timestamp, signature: btoa(String.fromCharCode(...new Uint8Array(signature))) };
}
export async function kalshiRequestError(path, data, error) {
  let body = data;
  const response = error?.context;
  if (response instanceof Response) {
    try { body = await response.clone().json(); } catch { /* Use HTTP status below. */ }
  }
  const status = response?.status;
  const label = path === '/portfolio/balance' ? 'Balance' : 'Market names';
  if (status === 400 && body?.error === 'Invalid Kalshi request. Check your key ID and device clock.') {
    return new Error(`${label}: the backend rejected ${path} (HTTP 400). The deployed kalshi-read function may be outdated; redeploy it with balance and market support.`);
  }
  const reason = typeof body?.error === 'string' ? body.error : status ? `Request failed (HTTP ${status}).` : 'Could not reach the Kalshi backend.';
  return new Error(`${label}: ${reason}`);
}
export async function fetchKalshiHistory(client, keyId, key, progress = () => {}, signal, previousCSV = '') {
  const maxTs = Math.floor(Date.now() / 1000) - 1;
  async function pages(path, field) {
    const result = [], seen = new Set();
    let cursor = '';
    do {
      signal?.throwIfAborted();
      if (seen.has(cursor) || seen.size >= 100) throw new Error('History is too large or pagination did not finish. Please use a CSV.');
      seen.add(cursor);
      progress(`Reading ${field}… ${result.length.toLocaleString()} records`);
      const headers = await signedHeaders(keyId, key, `/trade-api/v2${path}`);
      const { data, error } = await client.functions.invoke('kalshi-read', {
        body: { path, cursor, maxTs, ...headers }, signal,
      });
      if (error || data?.error) {
        let message = data?.error;
        if (!message && error?.context instanceof Response) {
          try { message = (await error.context.json()).error; } catch { /* Network/deployment errors use fallback. */ }
        }
        throw new Error(message || 'Kalshi sync is unavailable. Check that the kalshi-read function is deployed, then try again.');
      }
      if (!Array.isArray(data?.[field]) || (data.cursor != null && typeof data.cursor !== 'string')) throw new Error('Kalshi returned incomplete history. Try again.');
      result.push(...data[field]);
      cursor = data.cursor || '';
    } while (cursor);
    return result;
  }
  // Read archived fills first; deduplicate any overlap with the live tier.
  const historical = await pages('/historical/fills', 'fills');
  const recent = await pages('/portfolio/fills', 'fills');
  const settlements = await pages('/portfolio/settlements', 'settlements');
  const csv = historyToCSV([...historical, ...recent], settlements);
  const trades = parseKalshiCSV(csv).trades;
  const titles = new Map();
  if (previousCSV) {
    try {
      for (const trade of parseKalshiCSV(previousCSV).trades) {
        if (trade.ticker && trade.title) titles.set(trade.ticker, trade.title);
      }
    } catch { /* Invalid previous imports must not block a fresh import. */ }
  }
  async function read(path, extra = {}) {
    signal?.throwIfAborted();
    const headers = await signedHeaders(keyId, key, `/trade-api/v2${path}`);
    const { data, error } = await client.functions.invoke('kalshi-read', { body: { path, maxTs, ...extra, ...headers }, signal });
    if (error || data?.error) throw await kalshiRequestError(path, data, error);
    return data;
  }
  progress('Reading balance and market names…');
  const [balanceResult, titlesResult] = await Promise.allSettled([
    read('/portfolio/balance').then(data => balanceSnapshot(data, maxTs)),
    (async () => {
      const missing = [...new Set(trades.map(trade => trade.ticker))].filter(ticker => !titles.has(ticker));
      for (let i = 0; i < missing.length; i += 25) {
        let batch = missing.slice(i, i + 25);
        for (const path of ['/markets', '/historical/markets']) {
          if (!batch.length) break;
          const data = await read(path, { tickers: batch });
          if (!Array.isArray(data?.markets)) throw new Error('Market names unavailable.');
          for (const market of data.markets) {
            if (batch.includes(market.ticker) && typeof market.title === 'string' && market.title.trim()) {
              const subtitle = typeof market.yes_sub_title === 'string' ? market.yes_sub_title.trim() : '';
              titles.set(market.ticker, market.title.trim() + (subtitle && !market.title.includes(subtitle) ? ` · ${subtitle}` : ''));
            }
          }
          batch = batch.filter(ticker => !titles.has(ticker));
        }
      }
    })(),
  ]);
  signal?.throwIfAborted();
  // Optional enrichment cannot discard successfully reconstructed trade history.
  const snapshot = balanceResult.status === 'fulfilled' ? balanceResult.value : null;
  const issues = {};
  if (balanceResult.status === 'rejected') issues.balance = balanceResult.reason.message;
  if (titlesResult.status === 'rejected') issues.markets = titlesResult.reason.message;
  else if (trades.some(trade => !titles.has(trade.ticker))) issues.markets = 'Kalshi did not return a readable name for some markets, including the archive lookup. Their tickers are shown instead.';
  const rows = parseCSV(csv);
  rows[0].push('market_title', 'account_snapshot', 'sync_issues');
  for (let i = 1; i < rows.length; i++) {
    rows[i].push(titles.get(rows[i][3]) || '', i === 1 && snapshot ? JSON.stringify(snapshot) : '', i === 1 ? JSON.stringify(issues) : '');
  }
  return rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
}

export function balanceSnapshot(data, historyCutoff) {
  const cash = data?.balance_dollars != null ? number(data.balance_dollars, 'cash balance') : number(data?.balance, 'cash balance') / 100;
  const positions = number(data?.portfolio_value, 'portfolio value') / 100;
  if (cash < 0 || positions < 0) throw new Error('Invalid account balance.');
  return { cash, positions, fetchedAt: Date.now(), historyCutoff: historyCutoff * 1000 };
}

function number(value, field) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) throw new Error(`Kalshi history is missing valid ${field}. Use a CSV instead.`);
  return Number(value);
}
function time(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Kalshi history has an invalid timestamp.');
  return parsed;
}

export function settlementDiagnostic(fills, settlement, lots) {
  const matching = fills.filter(fill => (fill.ticker || fill.market_ticker) === settlement.ticker);
  const groups = new Map();
  const seen = new Set();
  for (const fill of matching) {
    const id = fill.fill_id || fill.trade_id;
    if (seen.has(id)) continue;
    seen.add(id);
    const fields = {
      exchange: fill.exchange_index ?? 'missing', subaccount: fill.subaccount_number ?? 'missing',
      outcome: fill.outcome_side ?? 'missing', book: fill.book_side ?? 'missing',
      action: fill.action ?? 'missing', side: fill.side ?? 'missing',
    };
    const key = JSON.stringify(fields);
    const group = groups.get(key) || { ...fields, fills: 0, quantity: 0 };
    group.fills++;
    group.quantity += Number(fill.count_fp ?? fill.count) || 0;
    groups.set(key, group);
  }
  // Deliberate allowlist: no credentials, signatures, user IDs, tickers, prices,
  // fees, or raw API responses. Enough to diagnose direction/schema mismatches.
  return {
    version: 1,
    exchange: settlement.exchange_index ?? 'missing',
    settlement: { yes: settlement.yes_count_fp ?? settlement.yes_count, no: settlement.no_count_fp ?? settlement.no_count },
    reconstructed: {
      yes: lots.filter(lot => lot.side === 'yes').reduce((sum, lot) => sum + lot.quantity, 0),
      no: lots.filter(lot => lot.side === 'no').reduce((sum, lot) => sum + lot.quantity, 0),
    },
    fillGroups: [...groups.values()],
  };
}
// FIFO matches opposing exposure. Fees are allocated to each closed quantity;
// fees on remaining open lots stay with those lots until sale or settlement.
export function historyToCSV(fills, settlements) {
  const events = [], ids = new Set(), settlementIds = new Set();
  for (const fill of fills) {
    if (fill.subaccount_number != null && fill.subaccount_number !== 0) continue;
    const id = fill.fill_id || fill.trade_id;
    if (!id) throw new Error('Kalshi returned a fill without an ID.');
    if (ids.has(id)) continue;
    ids.add(id);
    const side = fill.outcome_side || (fill.book_side ? (fill.book_side === 'bid' ? 'yes' : fill.book_side === 'ask' ? 'no' : '') :
      (fill.action === 'buy' ? fill.side : fill.action === 'sell' ? (fill.side === 'yes' ? 'no' : fill.side === 'no' ? 'yes' : '') : ''));
    if (!['yes', 'no'].includes(side)) throw new Error('Kalshi returned an unsupported trade direction.');
    const quantity = number(fill.count_fp ?? fill.count, 'contract quantity');
    const price = number(fill[`${side}_price_dollars`] ?? (fill[`${side}_price`] == null ? null : fill[`${side}_price`] / 100), 'fill price');
    if (quantity <= 0 || price < 0 || price > 1) throw new Error('Kalshi returned an invalid quantity or price.');
    events.push({ kind: 'fill', ticker: fill.ticker || fill.market_ticker, exchange: fill.exchange_index ?? 0, id, side, quantity, price,
      fee: number(fill.fee_cost, 'trade fees'), at: fill.created_time ? time(fill.created_time) : number(fill.ts, 'fill timestamp') * 1000 });
  }
  for (const settlement of settlements) {
    const at = time(settlement.settled_time);
    const id = `${settlement.exchange_index ?? 0}:${settlement.ticker}:${at}`;
    if (settlementIds.has(id)) continue;
    settlementIds.add(id);
    events.push({ kind: 'settlement', ticker: settlement.ticker, exchange: settlement.exchange_index ?? 0, id, at, settlement });
  }
  events.sort((a, b) => a.at - b.at || (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'fill' ? -1 : 1));
  const positions = new Map(), matched = new Map(), closes = [];
  for (const event of events) {
    if (!event.ticker) throw new Error('Kalshi history is missing a market ticker.');
    const market = `${event.exchange}:${event.ticker}`;
    const lots = positions.get(market) || [];
    positions.set(market, lots);
    if (event.kind === 'fill') {
      let remaining = event.quantity, pnl = 0, closed = 0, cost = 0;
      const closedSide = lots[0]?.side;
      const feePerContract = event.fee / event.quantity;
      while (remaining > 1e-8 && lots.length && lots[0].side !== event.side) {
        const lot = lots[0], quantity = Math.min(remaining, lot.quantity);
        pnl += quantity * (1 - event.price - lot.price - lot.fee - feePerContract);
        cost += quantity * (lot.price + lot.fee);
        closed += quantity; remaining -= quantity; lot.quantity -= quantity;
        if (lot.quantity < 1e-8) lots.shift();
      }
      if (closed) {
        closes.push({ at: event.at, pnl, cost, ticker: event.ticker, quantity: closed, side: closedSide, closeType: 'sale' });
        matched.set(market, (matched.get(market) || 0) + closed);
      }
      if (remaining > 1e-8) lots.push({ side: event.side, quantity: remaining, price: event.price, fee: feePerContract });
    } else {
      const s = event.settlement;
      const yes = number(s.yes_count_fp ?? s.yes_count, 'settlement quantity');
      const no = number(s.no_count_fp ?? s.no_count, 'settlement quantity');
      // Settlements can retain both gross legs after fills have been netted.
      // A YES/NO pair has no directional exposure and pays $1 in total.
      const paired = Math.min(yes, no);
      for (const [side, count] of [['yes', yes - paired], ['no', no - paired]]) {
        const reconstructed = lots.filter(lot => lot.side === side).reduce((sum, lot) => sum + lot.quantity, 0);
        if (yes < 0 || no < 0 || paired > (matched.get(market) || 0) + 1e-6 || Math.abs(count - reconstructed) > 1e-6) {
          const error = new Error('Kalshi returned conflicting position quantities. Your existing data has been kept. Copy the sync diagnostics below and send them here so we can identify the mismatch.');
          error.diagnostic = settlementDiagnostic(fills, s, lots);
          throw error;
        }
      }
      let revenue = number(s.revenue, 'settlement revenue') / 100;
      if (paired > 0) {
        const yesPayout = s.market_result === 'yes' ? 1 : s.market_result === 'no' ? 0 :
          s.market_result === 'scalar' ? number(s.value, 'scalar settlement value') / 100 : NaN;
        if (!Number.isFinite(yesPayout) || yesPayout < 0 || yesPayout > 1) throw new Error('Kalshi returned an unsupported settlement outcome. Your existing data has been kept.');
        const netPayout = (yes - paired) * yesPayout + (no - paired) * (1 - yesPayout);
        // API revenue is in integer cents. Retain its rounding, and accept only
        // an identifiable gross or net payout. Never count paired collateral twice.
        const grossDifference = Math.abs(revenue - (netPayout + paired));
        const netDifference = Math.abs(revenue - netPayout);
        if (Math.min(grossDifference, netDifference) > 0.010001) throw new Error('Kalshi settlement payout does not match its quantities. Your existing data has been kept.');
        if (grossDifference < netDifference) revenue -= paired;
      }
      if (lots.length) {
        const cost = lots.reduce((sum, lot) => sum + lot.quantity * (lot.price + lot.fee), 0);
        closes.push({ at: event.at, pnl: revenue - cost, cost, ticker: event.ticker, quantity: lots.reduce((sum, lot) => sum + lot.quantity, 0), side: lots[0].side, closeType: 'settlement' });
      }
      positions.set(market, []);
      matched.delete(market);
    }
  }
  if (!closes.length) throw new Error('No closed trades found in the primary account. Your existing data has been kept.');
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  return 'close_timestamp,realized_pnl_with_fees_dollars,entry_cost_dollars,ticker,quantity,side,close_type\n' + closes.map(row => `${new Date(row.at).toISOString()},${row.pnl.toFixed(8)},${row.cost.toFixed(8)},${quote(row.ticker)},${row.quantity},${row.side},${row.closeType}`).join('\n');
}
