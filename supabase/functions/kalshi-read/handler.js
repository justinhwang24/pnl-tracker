const paths = new Set(['/portfolio/fills', '/historical/fills', '/portfolio/settlements']);
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
export function createHandler({ supabaseUrl, supabaseKey, fetcher = fetch }) {
  const reply = (body, status = 200) => Response.json(body, { status, headers: cors });
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    if (!supabaseUrl || !supabaseKey) return reply({ error: 'Kalshi sync is not configured.' }, 503);
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in to sync Kalshi.' }, 401);
    try {
      const auth = await fetcher(`${supabaseUrl}/auth/v1/user`, {
        headers: { authorization, apikey: supabaseKey }, signal: AbortSignal.timeout(10000),
      });
      if (!auth.ok || !(await auth.json()).id) return reply({ error: 'Your session expired. Sign in again.' }, 401);
      // Bound the body before parsing; never log bodies, signatures, or upstream errors.
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: 'Invalid request.' }, 400);
      let length = 0; const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 12000) { await reader.cancel(); return reply({ error: 'Request too large.' }, 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({ error: 'Invalid request.' }, 400); }
      const { path, keyId, timestamp, signature, cursor = '', maxTs } = body || {};
      if (!paths.has(path) || typeof keyId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(keyId) ||
          typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60000 ||
          typeof signature !== 'string' || !/^[A-Za-z0-9+/=]{100,1500}$/.test(signature) ||
          typeof cursor !== 'string' || cursor.length > 4000 || !Number.isSafeInteger(maxTs) || maxTs < 0) {
        return reply({ error: 'Invalid Kalshi request. Check your key ID and device clock.' }, 400);
      }
      const url = new URL(`https://external-api.kalshi.com/trade-api/v2${path}`);
      url.searchParams.set('limit', '1000');
      url.searchParams.set('max_ts', String(maxTs));
      if (path !== '/historical/fills') url.searchParams.set('subaccount', '0');
      if (cursor) url.searchParams.set('cursor', cursor);
      const upstream = await fetcher(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { 'KALSHI-ACCESS-KEY': keyId, 'KALSHI-ACCESS-TIMESTAMP': timestamp, 'KALSHI-ACCESS-SIGNATURE': signature },
      });
      if (!upstream.ok) {
        const message = [401, 403].includes(upstream.status) ? 'Kalshi rejected the credentials. Check the key ID, private key, and read permissions.' :
          upstream.status === 429 ? 'Kalshi rate limit reached. Wait a minute and sync again.' : 'Kalshi history is unavailable. Please try again later.';
        return reply({ error: message }, upstream.status === 429 ? 429 : 502);
      }
      return reply(await upstream.json());
    } catch { return reply({ error: 'Could not reach Kalshi sync. Please try again.' }, 502); }
  };
}
