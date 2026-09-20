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
