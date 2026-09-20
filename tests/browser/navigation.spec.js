import { test, expect } from '@playwright/test';

test('homepage buttons lead to login and direct dashboard visits require a session', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Open dashboard' }).click();
  await expect(page).toHaveURL(/auth.html$/);
  await expect(page.getByText('Continue as a guest')).toHaveCount(0);
  await page.goto('/dashboard.html');
  await expect(page).toHaveURL(/auth.html$/);
  await expect(page.locator('#csvFile')).toHaveCount(0);
});

test('marketing and sign-in pages fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/', '/auth.html']) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('legacy calendar URL also requires login', async ({ page }) => {
  await page.goto('/kalshi_pnl_calendar.html');
  await expect(page).toHaveURL(/auth.html$/);
  await expect(page.locator('#csvFile')).toHaveCount(0);
});

test('signed-in homepage redirects to dashboard and profile menu supports keyboard and sign-out', async ({ page }) => {
  test.skip(process.env.SUPABASE_URL !== 'https://pnl-test.supabase.co', 'Requires mock accounts.');
  const { setup } = await import('./helpers.js');
  await setup(page);
  await page.goto('/');
  await expect(page).toHaveURL(/dashboard.html$/);
  await expect(page.locator('#profileBtn')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
  await expect(page.getByText('Upload Kalshi CSV', { exact: true })).toHaveCount(0);
  await expect(page.locator('#accountStatus')).toBeHidden();
  await expect(page.locator('#accountInfo')).toHaveCount(0);
  await expect(page.locator('#calendar').locator('..')).not.toContainText('Green =');
  await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeHidden();
  await page.locator('#profileBtn').click();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#profileDropdown')).toBeHidden();
  await expect(page.locator('#profileBtn')).toBeFocused();
  await page.locator('#profileBtn').click();
  await page.getByRole('heading', { name: 'Performance overview' }).click();
  await expect(page.locator('#profileDropdown')).toBeHidden();
  await page.locator('#profileBtn').click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#settingsPage')).toBeVisible();
  await page.locator('#profileBtn').click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page).toHaveURL(/auth.html$/);
});

test('unverified stored session stays on the public homepage', async ({ page }) => {
  test.skip(process.env.SUPABASE_URL !== 'https://pnl-test.supabase.co', 'Requires mock accounts.');
  const { setup } = await import('./helpers.js');
  await setup(page);
  await page.route('**/auth/v1/user', route => route.fulfill({ status: 401, json: { msg: 'Invalid token' } }));
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open dashboard' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
