// Keys are imported as non-extractable and are never sent to the backend or storage.
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
export async function fetchKalshiHistory(client, keyId, key, progress = () => {}, signal) {
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
  return historyToCSV([...historical, ...recent], settlements);
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
  const positions = new Map(), closes = [];
  for (const event of events) {
    if (!event.ticker) throw new Error('Kalshi history is missing a market ticker.');
    const market = `${event.exchange}:${event.ticker}`;
    const lots = positions.get(market) || [];
    positions.set(market, lots);
    if (event.kind === 'fill') {
      let remaining = event.quantity, pnl = 0, closed = 0;
      const feePerContract = event.fee / event.quantity;
      while (remaining > 1e-8 && lots.length && lots[0].side !== event.side) {
        const lot = lots[0], quantity = Math.min(remaining, lot.quantity);
        pnl += quantity * (1 - event.price - lot.price - lot.fee - feePerContract);
        closed += quantity; remaining -= quantity; lot.quantity -= quantity;
        if (lot.quantity < 1e-8) lots.shift();
      }
      if (closed) closes.push({ at: event.at, pnl });
      if (remaining > 1e-8) lots.push({ side: event.side, quantity: remaining, price: event.price, fee: feePerContract });
    } else {
      const s = event.settlement;
      const yes = number(s.yes_count_fp ?? s.yes_count, 'settlement quantity');
      const no = number(s.no_count_fp ?? s.no_count, 'settlement quantity');
      for (const [side, count] of [['yes', yes], ['no', no]]) {
        const reconstructed = lots.filter(lot => lot.side === side).reduce((sum, lot) => sum + lot.quantity, 0);
        if (count < 0 || Math.abs(count - reconstructed) > 1e-6) throw new Error('Trade history does not match settled positions. Use a CSV for this account.');
      }
      if (yes + no > 0) {
        const revenue = number(s.revenue, 'settlement revenue') / 100;
        const cost = lots.reduce((sum, lot) => sum + lot.quantity * (lot.price + lot.fee), 0);
        closes.push({ at: event.at, pnl: revenue - cost });
      }
      positions.set(market, []);
    }
  }
  if (!closes.length) throw new Error('No closed trades found in the primary account. Your existing data has been kept.');
  return 'close_timestamp,realized_pnl_with_fees_dollars\n' + closes.map(row => `${new Date(row.at).toISOString()},${row.pnl.toFixed(8)}`).join('\n');
}
