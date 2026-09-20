import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify, constants } from 'node:crypto';
import { importKalshiKey, signedHeaders, historyToCSV, fetchKalshiHistory } from '../src/kalshi.js';
import { parseKalshiCSV } from '../src/csv.js';
import { createHandler } from '../supabase/functions/kalshi-read/handler.js';

const fill = (id, side, quantity, price, fee, day = 1, ticker = 'A') => ({ fill_id: id, ticker, outcome_side: side,
  count_fp: String(quantity), yes_price_dollars: String(price), no_price_dollars: String(1-price), fee_cost: String(fee), created_time: `2026-01-0${day}T12:00:00Z` });
const settlement = (yes, no, revenue, day = 3) => ({ ticker: 'A', yes_count_fp: String(yes), no_count_fp: String(no), revenue, settled_time: `2026-01-0${day}T12:00:00Z` });
const pnls = (fills, settlements = []) => parseKalshiCSV(historyToCSV(fills, settlements)).trades.map(x => x.pnl);

test('FIFO closes allocate entry and exit fees, then settle remaining lots without double counting fees', () => {
  assert.deepEqual(pnls([fill('a', 'yes', 10, .4, .2), fill('b', 'yes', 10, .6, .1), fill('c', 'no', 15, .8, .3, 2)], [settlement(5, 0, 500)]), [4.45, 1.95]);
});
test('NO exposure, fractional contracts and scalar settlement use actual revenue', () => {
  assert.deepEqual(pnls([fill('a', 'no', 2.5, .7, .05)], [settlement(0, 2.5, 125)]), [.45]);
});
test('overlap is deduplicated, ordering is chronological, and nonprimary fills are excluded', () => {
  const a = fill('a', 'yes', 10, .4, .2);
  const b = fill('b', 'no', 10, .8, .3, 2);
  assert.deepEqual(pnls([b, a, a, { ...a, fill_id: 'other', subaccount_number: 1 }]), [3.5]);
});
test('a fill can close exposure and open the opposite side', () => {
  assert.deepEqual(pnls([fill('a', 'yes', 2, .4, 0), fill('b', 'no', 3, .6, 0, 2)], [settlement(0, 1, 100)]), [.4, .6]);
});
test('legacy buy/sell and book-side fields are supported', () => {
  const a = { ...fill('a', 'yes', 1, .4, 0), outcome_side: undefined, action: 'buy', side: 'yes' };
  const b = { ...fill('b', 'no', 1, .7, 0, 2), outcome_side: undefined, action: 'sell', side: 'yes' };
  assert.deepEqual(pnls([a, b]), [.3]);
  assert.deepEqual(pnls([{ ...a, book_side: 'bid' }, { ...b, book_side: 'ask' }]), [.3]);
});
test('incomplete data fails instead of manufacturing P&L', () => {
  assert.throws(() => pnls([], [settlement(10, 0, 1000)]), /does not match/);
  assert.throws(() => pnls([{ ...fill('a', 'yes', 1, .5, 0), fee_cost: undefined }]), /trade fees/);
  assert.throws(() => pnls([fill('a', 'yes', 1, .5, 0)]), /No closed trades/);
});
test('PKCS1 and PKCS8 keys produce valid RSA-PSS signatures without query parameters', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const type of ['pkcs1', 'pkcs8']) {
    const key = await importKalshiKey(privateKey.export({ type, format: 'pem' }));
    assert.equal(key.extractable, false);
    const headers = await signedHeaders('test-key', key, '/trade-api/v2/portfolio/fills?cursor=secret', '123');
    assert.ok(verify('sha256', Buffer.from('123GET/trade-api/v2/portfolio/fills'), {
      key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
    }, Buffer.from(headers.signature, 'base64')));
  }
  await assert.rejects(importKalshiKey('invalid'), /PEM/);
});
test('sync reads every page of both fill tiers and settlements', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = await importKalshiKey(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const calls = [];
  const client = { functions: { invoke: async (_name, { body }) => {
    calls.push(body);
    if (body.path === '/historical/fills') return { data: body.cursor ? { fills: [], cursor: '' } : { fills: [fill('a', 'yes', 1, .4, 0)], cursor: 'next' } };
    if (body.path === '/portfolio/fills') return { data: { fills: [fill('b', 'no', 1, .7, 0, 2)], cursor: '' } };
    return { data: { settlements: [] } };
  } } };
  assert.deepEqual(parseKalshiCSV(await fetchKalshiHistory(client, 'id', key)).trades.map(x => x.pnl), [.3]);
  assert.equal(calls.length, 4);
  assert.equal(calls[1].cursor, 'next');
  assert.ok(calls.every(x => !('privateKey' in x) && x.signature && x.maxTs === calls[0].maxTs));
  client.functions.invoke = async () => ({ data: { fills: [], cursor: 'repeat' } });
  await assert.rejects(fetchKalshiHistory(client, 'id', key), /pagination/);
});

const request = (body, authorization = 'Bearer token') => new Request('https://example.com', { method: 'POST', headers: { authorization }, body: JSON.stringify(body) });
const validBody = () => ({ path: '/portfolio/fills', keyId: 'id', signature: 'A'.repeat(344), timestamp: String(Date.now()), maxTs: 100 });
test('proxy authenticates the user, allows only fixed read endpoints, and never forwards Supabase tokens to Kalshi', async () => {
  const calls = [];
  const handler = createHandler({ supabaseUrl: 'https://test.supabase.co', supabaseKey: 'anon', fetcher: async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(String(url).includes('/auth/') ? { id: 'user' } : { fills: [], cursor: '' });
  } });
  assert.equal((await handler(request(validBody(), ''))).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await handler(request({ ...validBody(), path: '/portfolio/orders' }))).status, 400);
  assert.equal(calls.length, 1);
  const response = await handler(request({ ...validBody(), cursor: 'a&b' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const upstream = calls.at(-1);
  assert.equal(upstream.options.method, 'GET');
  assert.equal(upstream.options.headers.authorization, undefined);
  assert.equal(new URL(upstream.url).searchParams.get('cursor'), 'a&b');
  assert.equal(new URL(upstream.url).searchParams.get('subaccount'), '0');
  assert.equal(new URL(upstream.url).host, 'external-api.kalshi.com');
});
test('proxy rejects expired sessions and sanitizes upstream errors', async () => {
  const handler = createHandler({ supabaseUrl: 'https://test.supabase.co', supabaseKey: 'anon', fetcher: async url =>
    String(url).includes('/auth/') ? Response.json({ id: 'user' }) : new Response('sensitive upstream details', { status: 401 }) });
  const response = await handler(request(validBody()));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /rejected the credentials/);
  const expired = createHandler({ supabaseUrl: 'https://test.supabase.co', supabaseKey: 'anon', fetcher: async () => new Response('', { status: 401 }) });
  assert.equal((await expired(request(validBody()))).status, 401);
});
