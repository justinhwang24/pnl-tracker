import { setup } from './helpers.js';
import { test, expect } from '@playwright/test';

test.skip(process.env.SUPABASE_URL !== 'https://pnl-test.supabase.co', 'Requires mock account configuration.');
test.beforeEach(async ({ page }) => { await setup(page, true, ''); });

const csv = 'close_timestamp,realized_pnl_with_fees_dollars\n2026-01-01T01:00:00Z,10\n2026-01-01T10:00:00Z,-4\n2026-01-01T11:00:00Z,0';
async function upload(page, text = csv) {
  await page.locator('#csvFile').setInputFiles({ name: 'trades.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
}

test('starts empty, uploads, remembers CSV and timezone, and switches month and year', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/dashboard.html');
  await expect(page).toHaveURL(/dashboard\/$/);
  await expect(page.locator('#status')).toHaveText('Connect Kalshi or upload a CSV to begin.');
  await expect(page.locator('#monthPnl')).toHaveText('—');
  await expect(page.locator('.day')).toHaveCount(42);
  await changeTimeZone(page, 'UTC');
  await upload(page);
  await expect(page.locator('#status')).toContainText('Saved to your account');
  await expect(page.locator('#tradeCount')).toHaveText('3');
  await expect(page.locator('#monthPnl')).toHaveText('+$6.00');
  await expect(page.locator('#winRate')).toHaveText('33.3%');
  await expect(page.locator('#profitFactor')).toHaveText('2.50');
  await expect(page.locator('#drawdown')).toHaveText('-$4.00');
  await page.getByRole('button', { name: 'About P&L' }).focus();
  await expect(page.locator('.help').first().locator('.tooltip')).toBeVisible();
  await page.reload();
  await expect(page.locator('#status')).toContainText('Restored');
  await expect(page.locator('#monthPnl')).toHaveText('+$6.00');
  await changeTimeZone(page, 'America/New_York');
  await expect(page.locator('#monthPnl')).toHaveText('-$4.00');
  await expect(page.locator('#tradeCount')).toHaveText('2');
  await page.reload();
  await expect(page.locator('#monthPnl')).toHaveText('-$4.00');
  await page.locator('#prevMonth').click();
  await expect(page.locator('#monthPnl')).toHaveText('+$10.00');
  await expect(page.locator('#tradeCount')).toHaveText('1');
  await expect(page.locator('#profitFactor')).toHaveText('∞');
  await expect(page.locator('#resetBtn')).toHaveCount(0);
  await page.locator('#yearViewBtn').click();
  await expect(page.locator('#monthTitle')).toHaveText('2025');
  await expect(page.locator('.year-month')).toHaveCount(12);
  await expect(page.locator('#monthPnl')).toHaveText('+$10.00');
  await page.locator('#nextMonth').click();
  await expect(page.locator('#monthTitle')).toHaveText('2026');
  await expect(page.locator('#monthPnl')).toHaveText('-$4.00');
  await page.getByRole('button', { name: /January 2026.*Open month view/ }).click();
  await expect(page.locator('#pnlLabel')).toHaveText('Month P&L');
  await expect(page.locator('.day')).toHaveCount(42);
  await page.reload();
  await expect(page.locator('#monthPnl')).toHaveText('-$4.00');
  expect(errors).toEqual([]);
});

test('bad uploads preserve previously saved data and display an error', async ({ page }) => {
  await page.goto('/dashboard.html');
  await expect(page.locator('#csvFile')).toBeEnabled();
  await upload(page);
  await expect(page.locator('#status')).toContainText('Saved');
  await upload(page, 'invalid,headers\n1,2');
  await expect(page.locator('#status')).toContainText('Could not import CSV');
  await expect(page.locator('#tradeCount')).toHaveText('3');
  await page.reload();
  await expect(page.locator('#tradeCount')).toHaveText('3');
});

test('storage errors do not claim the CSV was saved, and retry works', async ({ page }) => {
  await page.goto('/dashboard.html');
  await expect(page.locator('#csvFile')).toBeEnabled();
  await page.route('**/rest/v1/pnl_uploads*', route => route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } }));
  await upload(page);
  await expect(page.locator('#status')).toContainText('not saved');
  await expect(page.locator('#saveBtn')).toBeVisible();
  await page.unroute('**/rest/v1/pnl_uploads*');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#status')).toContainText('Saved to your account');
  await expect(page.locator('#saveBtn')).toBeHidden();
});

test('mobile layout fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard.html');
  await expect(page.locator('#csvFile')).toBeEnabled();
  await upload(page);
  await expect(page.locator('#tradeCount')).toHaveText('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('cost-based returns and day details support hover and keyboard focus', async ({ page }) => {
  await page.goto('/dashboard.html');
  await expect(page.locator('#csvFile')).toBeEnabled();
  await upload(page, 'close_timestamp,realized_pnl_with_fees_dollars,entry_cost_dollars,ticker,quantity,market_title\n2026-01-02T12:00:00Z,50,100,MARKET-A,200,Will the Fed cut interest rates in January?\n2026-01-03T12:00:00Z,-25,100,MARKET-B,150,Will inflation fall below 3%?');
  await expect(page.locator('#averagePnl')).toHaveText('6.1%');
  await expect(page.locator('#drawdown')).toHaveText('-$25.00');
  const day = page.locator('[data-date="2026-01-02"]');
  await day.hover();
  await expect(day.getByRole('tooltip')).toBeVisible();
  await expect(day.locator('.day-trade-title')).toHaveText('Will the Fed cut interest rates in January?');
  await expect(day.locator('.day-trade-meta')).toContainText('200 contracts');
  await expect(day.locator('.day-trade-result')).toContainText('+$50.00');
  await expect(day.locator('.day-trade-return')).toHaveText('50.0% return');
  await page.locator('h1').hover();
  await expect(day.getByRole('tooltip')).toBeHidden();
  await day.focus();
  await expect(day.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(day.getByRole('tooltip')).toBeHidden();
  await page.locator('#yearViewBtn').click();
  expect(await page.locator('.year-month').first().evaluate(el => getComputedStyle(el).fontFamily)).toBe(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily));
});

test('today follows the calendar timezone and hover cards fit mobile edges', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-03T01:00:00Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard.html');
  await changeTimeZone(page, 'America/New_York');
  await upload(page, 'close_timestamp,realized_pnl_with_fees_dollars\n2026-01-02T12:00:00Z,50');
  const day = page.locator('[data-date="2026-01-02"]');
  await expect(day).toHaveAttribute('aria-current', 'date');
  await expect(page.locator('.today')).toHaveCount(1);
  await day.click();
  const tooltip = day.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  const box = await tooltip.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: test.info().outputPath('calendar-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
});

test('session verification displays a skeleton until data loads', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/auth/v1/user', async route => { await pending; await route.fallback(); });
  await page.goto('/dashboard.html');
  await expect(page.locator('.skeleton-calendar')).toBeVisible();
  await expect(page.locator('#dashboard')).toBeHidden();
  release();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#authGate')).toBeHidden();
});

async function changeTimeZone(page, zone) {
  await page.getByRole('button', { name: 'Profile', exact: false }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('#timeZone').selectOption(zone);
  await page.locator('#saveSettings').click();
  await expect(page.locator('#settingsStatus')).toHaveText('Settings saved to your account.');
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page.locator('#csvFile')).toBeEnabled();
}
