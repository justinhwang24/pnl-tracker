import { setup } from './helpers.js';
import { test, expect } from '@playwright/test';

const mockUrl = 'https://pnl-test.supabase.co';
test.skip(process.env.SUPABASE_URL !== mockUrl, 'Run with the documented mock Supabase configuration.');
const csv = 'close_timestamp,realized_pnl_with_fees_dollars\n2026-01-01T01:00:00Z,15';
const id = '11111111-1111-4111-8111-111111111111';

test('Google sign-in starts OAuth with the dashboard return URL', async ({ page }) => {
  await setup(page, false);
  await page.route(`${mockUrl}/auth/v1/settings`, route => route.fulfill({ json: { external: { google: true } } }));
  await page.route(`${mockUrl}/auth/v1/authorize*`, async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:8001/dashboard.html');
    await route.fulfill({ contentType: 'text/html', body: '<p>OAuth provider</p>' });
  });
  await page.goto('/auth.html');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/auth\/v1\/authorize\?/);
});

test('disabled Google provider leaves email login available', async ({ page }) => {
  await setup(page, false);
  await page.route(`${mockUrl}/auth/v1/settings`, route => route.fulfill({ json: { external: { google: false } } }));
  await page.goto('/auth.html');
  await page.locator('#googleSignInBtn').click();
  await expect(page.locator('#authStatus')).toContainText('Google sign-in is not available yet');
  await expect(page.locator('#signInBtn')).toBeEnabled();
  await expect(page).toHaveURL(/auth.html$/);
});

test('canceled Google sign-in returns to login with a retry message', async ({ page }) => {
  await setup(page, false);
  await page.goto('/dashboard.html#error=access_denied&error_description=User+canceled');
  await expect(page.locator('#authStatus')).toContainText('Sign-in was canceled');
  await expect(page.locator('#googleSignInBtn')).toBeEnabled();
});

test('account upload restores, replaces, survives reload, clears, and signs out to login', async ({ page }) => {
  const { rows } = await setup(page);
  await page.goto('/dashboard.html');
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
  await expect(page).toHaveURL(/auth.html$/);
  await expect(page.locator('#monthPnl')).toHaveCount(0);
  expect(rows.has(id)).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(/auth.html$/);
});

test('email form requests a sign-in link without claiming to be authenticated', async ({ page }) => {
  const { calls } = await setup(page, false);
  await page.goto('/auth.html');
  await page.locator('#email').fill('test@example.com');
  await page.locator('#signInBtn').click();
  await expect(page.locator('#authStatus')).toContainText('Check your email');
  await expect(page).toHaveURL(/auth.html$/);
  expect(calls).toContain('/auth/v1/otp');
});

test('signed-in users visiting auth go directly to their dashboard', async ({ page }) => {
  await setup(page);
  await page.goto('/auth.html');
  await expect(page).toHaveURL(/dashboard.html#?$/);
  await expect(page.locator('#monthPnl')).toHaveText('+$15.00');
});

test('email callback establishes a session and restores the dashboard', async ({ page }) => {
  await setup(page, false);
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp: expires, role: 'authenticated' })).toString('base64url')}.test-signature`;
  await page.goto(`/dashboard.html#access_token=${token}&refresh_token=test-refresh&expires_in=3600&token_type=bearer&type=magiclink`);
  await expect(page.locator('#monthPnl')).toHaveText('+$15.00');
  await expect(page).toHaveURL(/dashboard.html#?$/);
  await page.reload();
  await expect(page.locator('#accountInfo')).toContainText('test@example.com');
});

test('expired email links allow requesting a fresh link', async ({ page }) => {
  await setup(page, false);
  await page.goto('/dashboard.html#error=access_denied&error_code=otp_expired');
  await expect(page.locator('#authStatus')).toContainText('invalid or expired');
  await expect(page.locator('#signInBtn')).toBeEnabled();
});

test('email delivery failures stay on login and allow retry', async ({ page }) => {
  await setup(page, false);
  await page.route('**/auth/v1/otp*', route => route.fulfill({ status: 429, json: { msg: 'Please wait before requesting another email.' } }));
  await page.goto('/auth.html');
  await page.locator('#email').fill('test@example.com');
  await page.locator('#signInBtn').click();
  await expect(page.locator('#authStatus')).toContainText('Could not send sign-in link');
  await expect(page.locator('#signInBtn')).toBeEnabled();
  await expect(page).toHaveURL(/auth.html$/);
});

test('a rejected stored session never reveals the dashboard', async ({ page }) => {
  await setup(page);
  await page.route('**/auth/v1/user', route => route.fulfill({ status: 401, json: { msg: 'Invalid token' } }));
  await page.goto('/dashboard.html');
  await expect(page).toHaveURL(/auth.html$/);
  await expect(page.locator('#signInBtn')).toBeEnabled();
  await expect(page.locator('#csvFile')).toHaveCount(0);
});
