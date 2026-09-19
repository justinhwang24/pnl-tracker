import { test, expect } from '@playwright/test';

const csv = 'close_timestamp,realized_pnl_with_fees_dollars\n2026-01-01T01:00:00Z,10\n2026-01-01T10:00:00Z,-4\n2026-01-01T11:00:00Z,0';
async function upload(page, text = csv) {
  await page.locator('#csvFile').setInputFiles({ name: 'trades.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
}

test('starts empty, uploads, remembers CSV and timezone, regroups months, and clears', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Upload a CSV to begin.');
  await expect(page.locator('#monthPnl')).toHaveText('—');
  await expect(page.locator('.day')).toHaveCount(42);
  await page.locator('#timeZone').selectOption('UTC');
  await expect(page.locator('#status')).toContainText('Saved in this browser');
  await upload(page);
  await expect(page.locator('#status')).toContainText('Saved in this browser');
  await expect(page.locator('#tradeCount')).toHaveText('3');
  await expect(page.locator('#monthPnl')).toHaveText('+$6.00');
  await expect(page.locator('#winRate')).toHaveText('33.3%');
  await expect(page.locator('#profitFactor')).toHaveText('2.50');
  await expect(page.locator('#drawdown')).toHaveText('-$4.00');
  await page.reload();
  await expect(page.locator('#status')).toContainText('Restored');
  await expect(page.locator('#monthPnl')).toHaveText('+$6.00');
  await page.locator('#timeZone').selectOption('America/New_York');
  await expect(page.locator('#monthPnl')).toHaveText('-$4.00');
  await expect(page.locator('#tradeCount')).toHaveText('2');
  await page.reload();
  await expect(page.locator('#timeZone')).toHaveValue('America/New_York');
  await page.locator('#prevMonth').click();
  await expect(page.locator('#monthPnl')).toHaveText('+$10.00');
  await expect(page.locator('#tradeCount')).toHaveText('1');
  await expect(page.locator('#profitFactor')).toHaveText('∞');
  await page.locator('#resetBtn').click();
  await expect(page.locator('#status')).toHaveText('Saved CSV cleared.');
  await page.reload();
  await expect(page.locator('#monthPnl')).toHaveText('—');
  expect(errors).toEqual([]);
});

test('bad uploads preserve previously saved data and display an error', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/');
  await expect(page.locator('#csvFile')).toBeEnabled();
  await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('Quota exceeded'); }; });
  await upload(page);
  await expect(page.locator('#status')).toContainText('not saved');
  await expect(page.locator('#saveBtn')).toBeVisible();
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  await page.locator('#saveBtn').click();
  await expect(page.locator('#status')).toContainText('Saved in this browser');
  await expect(page.locator('#saveBtn')).toBeHidden();
});

test('mobile layout fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#csvFile')).toBeEnabled();
  await upload(page);
  await expect(page.locator('#tradeCount')).toHaveText('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
