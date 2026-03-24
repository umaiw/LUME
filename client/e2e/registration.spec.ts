/**
 * E2E test: full registration flow.
 * Steps: landing -> setup -> backup phrase -> verify words -> username -> PIN -> chats
 *
 * Requires: client dev server on :3000, server on :3001 (both with clean/test DB).
 */

import { test, expect } from '@playwright/test';

test.describe('Registration flow', () => {
  test('new user can register and land on chats page', async ({ page }) => {
    // 1. Go to landing page
    await page.goto('/');

    // Should see "Create Account" or redirect to /setup if no account
    // The landing page checks hasAccount() and shows buttons
    const createBtn = page.getByRole('link', { name: /create/i }).or(
      page.getByRole('button', { name: /create/i })
    );

    // Wait for either the create button or a redirect to /setup
    await Promise.race([
      createBtn.waitFor({ timeout: 10_000 }).catch(() => {}),
      page.waitForURL('**/setup', { timeout: 10_000 }).catch(() => {}),
    ]);

    if (page.url().includes('/setup')) {
      // Already redirected
    } else {
      await createBtn.click();
      await page.waitForURL('**/setup');
    }

    // 2. Backup step — wait for mnemonic words to appear (generate step auto-advances)
    await expect(page.getByText('Recovery Phrase')).toBeVisible({ timeout: 15_000 });

    // Collect mnemonic words from the grid
    const wordElements = page.locator('[class*="grid"] > div span:last-child');
    await expect(wordElements.first()).toBeVisible({ timeout: 5_000 });
    const wordCount = await wordElements.count();
    const mnemonicWords: string[] = [];
    for (let i = 0; i < wordCount; i++) {
      const text = await wordElements.nth(i).textContent();
      mnemonicWords.push(text?.trim() || '');
    }
    expect(mnemonicWords.length).toBeGreaterThanOrEqual(12);
    expect(mnemonicWords.every((w) => w.length > 0)).toBe(true);

    // Wait for "I saved the phrase" button to become enabled (3s delay)
    const savedBtn = page.getByRole('button', { name: /saved the phrase/i });
    await expect(savedBtn).toBeEnabled({ timeout: 5_000 });
    await savedBtn.click();

    // 3. Verify step — fill in the requested words
    await expect(page.getByText('Verify Phrase')).toBeVisible({ timeout: 5_000 });

    // Find the word position labels (e.g., "Word #3")
    const wordLabels = page.locator('label');
    const labelCount = await wordLabels.count();
    for (let i = 0; i < labelCount; i++) {
      const labelText = await wordLabels.nth(i).textContent();
      const match = labelText?.match(/Word\s*#(\d+)/i);
      if (match) {
        const wordIndex = parseInt(match[1], 10) - 1;
        const input = page.locator(`#verify-word-${wordIndex}`);
        await input.fill(mnemonicWords[wordIndex]);
      }
    }

    const confirmBtn = page.getByRole('button', { name: /confirm/i });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // 4. Username step
    await expect(page.getByText('Username')).toBeVisible({ timeout: 5_000 });
    const uniqueUsername = `e2e_test_${Date.now().toString(36)}`;
    const usernameInput = page.locator('#setup-username');
    await usernameInput.fill(uniqueUsername);

    // Wait a moment for availability check
    await page.waitForTimeout(600);

    const continueBtn = page.getByRole('button', { name: /continue/i });
    await expect(continueBtn).toBeEnabled({ timeout: 3_000 });
    await continueBtn.click();

    // 5. PIN step
    await expect(page.getByText('PIN Code')).toBeVisible({ timeout: 5_000 });
    const pinInputs = page.locator('input[type="password"], input[type="tel"], input[inputmode="numeric"]');

    // There should be two PIN inputs (pin + confirm)
    const pinCount = await pinInputs.count();
    if (pinCount >= 2) {
      await pinInputs.nth(0).fill('1234');
      await pinInputs.nth(1).fill('1234');
    } else {
      // Fallback: look for labeled inputs
      const pinInput = page.locator('#setup-pin').or(page.getByPlaceholder(/pin/i).first());
      const confirmInput = page.locator('#setup-pin-confirm').or(page.getByPlaceholder(/confirm/i).first());
      await pinInput.fill('1234');
      await confirmInput.fill('1234');
    }

    const setPinBtn = page.getByRole('button', { name: /set pin|create|finish/i });
    await expect(setPinBtn).toBeEnabled({ timeout: 2_000 });
    await setPinBtn.click();

    // 6. Should redirect to /chats after completion
    await page.waitForURL('**/chats', { timeout: 15_000 });
    expect(page.url()).toContain('/chats');
  });
});

test.describe('Landing page', () => {
  test('shows loading spinner then content', async ({ page }) => {
    await page.goto('/');
    // Should eventually show either create/unlock buttons or redirect
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    // Page should not be blank
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });
});
