import { test, expect } from '@playwright/test';

const mockUrl = 'https://pnl-test.supabase.co';
test.skip(process.env.SUPABASE_URL !== mockUrl, 'Run with the documented mock Supabase configuration.');
const csv = 'close_timestamp,realized_pnl_with_fees_dollars\n2026-01-01T01:00:00Z,15';
const id = '11111111-1111-4111-8111-111111111111';

async function setup(page, signedIn = true) {
  const rows = new Map([[id, { csv, filename: 'account.csv', time_zone: 'UTC' }]]);
  const calls = [];
  await page.route(`${mockUrl}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push(url.pathname);
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

test('account upload restores, replaces, survives reload, clears, and stays separate from guests', async ({ page }) => {
  const { rows } = await setup(page);
  await page.goto('/');
  await expect(page.locator('#accountInfo')).toHaveText('Signed in as test@example.com');
  await expect(page.locator('#monthPnl')).toHaveText('+$15.00');
  await page.locator('#csvFile').setInputFiles({ name: 'replacement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.replace(',15', ',20')) });
  await expect(page.locator('#status')).toHaveText('Saved to your account.');
  expect(rows.get(id).filename).toBe('replacement.csv');
  await page.reload();
  await expect(page.locator('#monthPnl')).toHaveText('+$20.00');
  await page.locator('#resetBtn').click();
  await expect(page.locator('#status')).toHaveText('Saved CSV cleared.');
  expect(rows.has(id)).toBe(false);
  await page.locator('#csvFile').setInputFiles({ name: 'again.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('#status')).toHaveText('Saved to your account.');
  await page.locator('#signOutBtn').click();
  await expect(page.locator('#accountInfo')).toContainText('Guest');
  await expect(page.locator('#monthPnl')).toHaveText('—');
  expect(rows.has(id)).toBe(true);
  await page.reload();
  await expect(page.locator('#monthPnl')).toHaveText('—');
});

test('email form requests a sign-in link without claiming to be authenticated', async ({ page }) => {
  const { calls } = await setup(page, false);
  await page.goto('/');
  await page.locator('#email').fill('test@example.com');
  await page.locator('#signInBtn').click();
  await expect(page.locator('#authStatus')).toContainText('Check your email');
  await expect(page.locator('#accountInfo')).toContainText('Guest');
  expect(calls).toContain('/auth/v1/otp');
});
