import { test, expect } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { setup } from './helpers.js';
const mockUrl = 'https://pnl-test.supabase.co';
test.skip(process.env.SUPABASE_URL !== mockUrl, 'Run with the documented mock Supabase configuration.');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
const entry = { fill_id: 'entry', ticker: 'A', outcome_side: 'yes', count_fp: '10', yes_price_dollars: '.4', no_price_dollars: '.6', fee_cost: '.2', created_time: '2026-01-01T12:00:00Z' };
const exit = { ...entry, fill_id: 'exit', outcome_side: 'no', yes_price_dollars: '.8', no_price_dollars: '.2', fee_cost: '.3', created_time: '2026-01-02T12:00:00Z' };

async function credentials(page) {
  await page.getByRole('link', { name: 'Connect Kalshi' }).click();
  await expect(page).toHaveURL(/(?:settings\.html|settings\/)#kalshiPanel$/);
  await page.getByLabel('API key ID', { exact: true }).fill('test-key-id');
  await page.getByLabel('Private key', { exact: true }).fill(pem);
}

test('API sync signs locally, saves results, refreshes without duplicates, and forgets credentials', async ({ page }) => {
  const { rows } = await setup(page);
  await page.route(`${mockUrl}/functions/v1/kalshi-read`, async route => {
    const body = route.request().postDataJSON();
    expect(body.signature).toBeTruthy();
    expect(body.keyId).toBe('test-key-id');
    expect(JSON.stringify(body)).not.toContain('PRIVATE KEY');
    const data = body.path === '/historical/fills' ? { fills: [entry], cursor: '' } : body.path === '/portfolio/fills' ? { fills: [entry, exit], cursor: '' } : { settlements: [] };
    await route.fulfill({ json: data });
  });
  await page.goto('/dashboard.html');
  await expect(page.locator('#monthPnl')).toHaveText('+$15.00');
  await credentials(page);
  await page.getByRole('button', { name: 'Sync Kalshi', exact: true }).click();
  await expect(page).toHaveURL(/(?:dashboard\.html|dashboard\/)$/);
  await expect(page.locator('#monthPnl')).toHaveText('+$3.50');
  await expect(page.locator('#tradeCount')).toHaveText('1');
  await expect(page.locator('#kalshiPrivateKey')).toHaveCount(0);
  await expect(page.locator('#fileInfo')).toHaveCount(0);
  await expect(page.locator('#refreshKalshiBtn')).toBeVisible();
  expect(JSON.stringify([...rows.values()])).not.toContain('PRIVATE KEY');
  const stored = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
  expect(stored).not.toContain('PRIVATE KEY');
  expect(stored).not.toContain('test-key-id');
  await page.getByRole('button', { name: 'Sync Kalshi', exact: true }).click();
  await expect(page).toHaveURL(/(?:settings\.html|settings\/)#kalshiPanel$/);
  await page.getByLabel('API key ID', { exact: true }).fill('test-key-id');
  await page.getByLabel('Private key', { exact: true }).fill(pem);
  await page.locator('#kalshiSyncBtn').click();
  await expect(page).toHaveURL(/(?:dashboard\.html|dashboard\/)$/);
  await expect(page.locator('#tradeCount')).toHaveText('1');
  await page.locator('#profileBtn').click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Forget credentials' }).click();
  await expect(page.locator('#kalshiKeyId')).toHaveValue('');
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page.locator('#monthPnl')).toHaveText('+$3.50');
  await page.reload();
  await expect(page.locator('#monthPnl')).toHaveText('+$3.50');
  await expect(page.locator('#kalshiKeyId')).toHaveCount(0);
});

test('failed API sync preserves previous data and permits retry and CSV upload', async ({ page }) => {
  await setup(page);
  await page.route(`${mockUrl}/functions/v1/kalshi-read`, route => route.fulfill({ status: 502, json: { error: 'Kalshi rejected the credentials.' } }));
  await page.goto('/dashboard.html');
  await credentials(page);
  await page.getByRole('button', { name: 'Sync Kalshi', exact: true }).click();
  await expect(page.locator('#kalshiStatus')).toContainText('Kalshi rejected the credentials');
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page.locator('#monthPnl')).toHaveText('+$15.00');
  await expect(page.locator('#csvFile')).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Connect Kalshi' })).toBeVisible();
});

test('settlement mismatch keeps saved data and offers credential-free diagnostics', async ({ page }) => {
  await setup(page);
  await page.route(`${mockUrl}/functions/v1/kalshi-read`, route => {
    const { path } = route.request().postDataJSON();
    return route.fulfill({ json: path === '/portfolio/settlements' ? { settlements: [{
      ticker: 'PRIVATE-MARKET', yes_count_fp: '10', no_count_fp: '0', revenue: 1000,
      settled_time: '2026-01-03T12:00:00Z',
    }] } : { fills: [], cursor: '' } });
  });
  await page.goto('/dashboard.html');
  await credentials(page);
  await page.getByRole('button', { name: 'Sync Kalshi', exact: true }).click();
  await expect(page.locator('#kalshiDiagnostics')).toBeVisible();
  const diagnostic = await page.locator('#kalshiDiagnosticText').inputValue();
  expect(JSON.parse(diagnostic).settlement).toEqual({ yes: '10', no: '0' });
  expect(diagnostic).not.toMatch(/PRIVATE-MARKET|PRIVATE KEY|test-key-id/);
  await expect(page.getByRole('button', { name: 'Copy sync diagnostics' })).toBeVisible();
  await page.getByRole('button', { name: 'Forget credentials' }).click();
  await expect(page.locator('#kalshiDiagnostics')).toBeHidden();
  await expect(page.locator('#kalshiDiagnosticText')).toHaveValue('');
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page.locator('#monthPnl')).toHaveText('+$15.00');
});

test('gross settlement quantities sync into net FIFO P&L and survive reload', async ({ page }) => {
  await setup(page);
  await page.route(`${mockUrl}/functions/v1/kalshi-read`, route => {
    const { path } = route.request().postDataJSON();
    const fills = [
      { ...entry, outcome_side: 'no', count_fp: '16.35', yes_price_dollars: '.6', no_price_dollars: '.4', fee_cost: '.1635' },
      { ...exit, outcome_side: 'yes', count_fp: '13.51', yes_price_dollars: '.3', no_price_dollars: '.7', fee_cost: '.1351', action: 'sell', side: 'yes' },
    ];
    return route.fulfill({ json: path === '/historical/fills' ? { fills: [], cursor: '' } : path === '/portfolio/fills' ? { fills, cursor: '' } : {
      settlements: [{ ticker: 'A', yes_count_fp: '13.51', no_count_fp: '16.35', revenue: 1635, market_result: 'no', settled_time: '2026-01-03T12:00:00Z' }],
    } });
  });
  await page.goto('/dashboard.html');
  await credentials(page);
  await page.getByRole('button', { name: 'Sync Kalshi', exact: true }).click();
  await expect(page).toHaveURL(/(?:dashboard\.html|dashboard\/)$/);
  await expect(page.locator('#monthPnl')).toHaveText('+$5.46');
  await expect(page.locator('#tradeCount')).toHaveText('2');
  await expect(page.locator('#kalshiDiagnostics')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#monthPnl')).toHaveText('+$5.46');
});
