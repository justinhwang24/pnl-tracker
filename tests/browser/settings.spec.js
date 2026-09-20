import { test, expect } from '@playwright/test';
import { setup } from './helpers.js';

test.skip(process.env.SUPABASE_URL !== 'https://pnl-test.supabase.co', 'Requires mock accounts.');

test('settings persist and control calendar precision, trade counts, and every week start', async ({ page }) => {
  await setup(page, true, 'close_timestamp,realized_pnl_with_fees_dollars\n2026-01-01T10:00:00Z,15.75');
  await page.goto('/dashboard.html');
  await expect(page.locator('#timeZone')).toHaveCount(0);
  await expect(page.locator('[data-date="2026-01-01"] .pnl')).toHaveText('+$16');
  await expect(page.locator('.trade-count')).toHaveCount(1);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#timeZone')).toHaveValue('UTC');
  await page.locator('#showTrades').uncheck();
  await page.locator('#rounding').uncheck();
  await page.locator('#weekStart').selectOption('0');
  await page.locator('#saveSettings').click();
  await expect(page.locator('#settingsStatus')).toContainText('Settings saved');
  await page.reload();
  await expect(page.locator('#showTrades')).not.toBeChecked();
  await expect(page.locator('#rounding')).not.toBeChecked();
  await expect(page.locator('#weekStart')).toHaveValue('0');
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page.locator('[data-date="2026-01-01"] .pnl')).toHaveText('+$15.75');
  await expect(page.locator('.trade-count')).toHaveCount(0);
  await expect(page.locator('#monthPnl')).toHaveText('+$15.75');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let start = 0; start < 7; start++) {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.locator('#weekStart').selectOption(String(start));
    await page.locator('#saveSettings').click();
    await expect(page.locator('#settingsStatus')).toContainText('Settings saved');
    await page.getByRole('link', { name: 'Back to dashboard' }).click();
    await expect(page.locator('#weekdays .weekday').first()).toHaveText(days[start]);
    const expected = new Date(2026, 0, 1 - ((4 - start + 7) % 7));
    const date = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
    await expect(page.locator('.day').first()).toHaveAttribute('data-date', date);
  }
});

test('settings require sign-in', async ({ page }) => {
  await setup(page, false);
  await page.goto('/settings.html');
  await expect(page).toHaveURL(/auth.html$/);
});

test('save failures are visible and can be retried; mobile settings fit', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/settings.html');
  await expect(page.locator('#settingsPage')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/auth/v1/user', route => route.fulfill({ status: 500, json: { msg: 'Unable to save' } }));
  await page.locator('#saveSettings').click();
  await expect(page.locator('#settingsStatus')).toContainText('Could not save settings');
  await page.unroute('**/auth/v1/user');
  await page.locator('#saveSettings').click();
  await expect(page.locator('#settingsStatus')).toContainText('Settings saved');
});
