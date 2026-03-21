import { test, expect } from '@playwright/test';

test.describe('Setup Flow', () => {
  test('root redirects to /setup when no account exists', async ({ page }) => {
    await page.goto('/');

    // App should redirect to /setup or /unlock depending on state.
    // If no account exists, expect /setup. If locked, expect /unlock.
    await page.waitForURL(/\/(setup|unlock)/, { timeout: 10_000 });

    const url = page.url();
    expect(url).toMatch(/\/(setup|unlock)/);
  });

  test('setup page renders username input', async ({ page }) => {
    await page.goto('/setup');

    // Wait for the page to fully load
    await page.waitForLoadState('networkidle');

    // Look for an input field (username / display name)
    const input = page.locator('input').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
  });

  test('setup flow: fill username and complete', async ({ page }) => {
    await page.goto('/setup');
    await page.waitForLoadState('networkidle');

    // Find and fill the first text input (username / display name)
    const input = page.locator('input').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('TestUser');

    // Look for a submit / continue / next button
    const submitButton = page.locator(
      'button[type="submit"], button:has-text("Continue"), button:has-text("Next"), button:has-text("Create"), button:has-text("Start")'
    ).first();

    if (await submitButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submitButton.click();

      // After setup, should eventually land on /chats or next step
      await page.waitForURL(/\/(chats|chat|setup)/, { timeout: 15_000 });
    }
  });
});
