import { expect } from '@playwright/test';
const mockUrl = 'https://pnl-test.supabase.co';
const csv = 'close_timestamp,realized_pnl_with_fees_dollars\n2026-01-01T01:00:00Z,15';
const id = '11111111-1111-4111-8111-111111111111';
export async function setup(page, signedIn = true, initialCsv = csv) {
  const rows = new Map([[id, { csv: initialCsv, filename: 'account.csv', time_zone: 'UTC' }]]);
  if (!initialCsv) rows.clear();
  const calls = [];
  let metadata = {};
  await page.route(`${mockUrl}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') {
      if (request.method() === 'PUT') metadata = { ...metadata, ...request.postDataJSON().data };
      return route.fulfill({ json: { id, email: 'test@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: metadata } });
    }
    if (url.pathname === '/rest/v1/pnl_uploads') {
      if (request.method() === 'GET') {
        expect(url.searchParams.get('user_id')).toBe(`eq.${id}`);
        return route.fulfill({ json: rows.get(id) || null });
      }
      if (request.method() === 'POST') {
        const row = request.postDataJSON();
        expect(row.user_id).toBe(id);
        rows.set(id, row);
        return route.fulfill({ status: 201, body: '' });
      }
      if (request.method() === 'DELETE') {
        expect(url.searchParams.get('user_id')).toBe(`eq.${id}`);
        rows.delete(id);
        return route.fulfill({ status: 204 });
      }
    }
    if (url.pathname === '/auth/v1/logout' || url.pathname === '/auth/v1/otp') {
      if (url.pathname === '/auth/v1/otp') {
        expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:8001/dashboard.html');
      }
      return route.fulfill({ json: {} });
    }
    throw new Error(`Unexpected Supabase request ${request.method()} ${url.pathname}`);
  });
  if (signedIn) {
    await page.addInitScript(({ id }) => {
      // Seed once; reload and sign-out must use the SDK's actual persistence behavior.
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', 'true');
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: id, exp: expires, role: 'authenticated' }))}.test-signature`;
      localStorage.setItem('sb-pnl-test-auth-token', JSON.stringify({
        access_token: token, refresh_token: 'test-refresh-token', token_type: 'bearer',
        expires_at: expires, expires_in: 3600,
        user: { id, email: 'test@example.com', aud: 'authenticated', role: 'authenticated' },
      }));
    }, { id });
  }
  return { rows, calls };
}
