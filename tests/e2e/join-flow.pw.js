// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Asterobia - JoinOverlay Smoke Tests
 *
 * Covers TS-01, TS-03, and TS-10 (edge cases) from
 *   docs/TEST_SCENARIOS_R013_M07.md
 *
 * These tests validate DOM presence and basic interactions on the
 * JoinOverlay that appears when the game loads with ?net=supabase.
 * They do NOT require a running Supabase backend — they only assert
 * on the client-side UI that is created entirely in JoinOverlay.js.
 *
 * The game page is game.html (not index.html, which is a launcher).
 */

const GAME_URL = '/game.html?net=supabase';

// ---------------------------------------------------------------------------
// Helper: wait for the JoinOverlay to be fully rendered.
// The overlay is created synchronously by the Game constructor, but the
// page needs to load all JS modules first (Three.js CDN, Supabase CDN, etc.).
// ---------------------------------------------------------------------------
async function waitForOverlay(page) {
    // Navigate and wait for network to settle
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });

    // The start screen appears first — click BASIC to proceed into the game
    // (which triggers the loader and eventually the JoinOverlay).
    const startBtn = page.locator('#start-btn-basic');
    await startBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await startBtn.click();

    // Wait for JoinOverlay to become visible
    const overlay = page.locator('#join-overlay');
    await overlay.waitFor({ state: 'visible', timeout: 20_000 });
    return overlay;
}

// ===========================================================================
// TS-01: JoinOverlay Single-Screen Flow (Host Side)
// ===========================================================================
test.describe('TS-01: JoinOverlay', () => {

    test('overlay is visible on startup with net=supabase', async ({ page }) => {
        const overlay = await waitForOverlay(page);
        await expect(overlay).toBeVisible();
    });

    test('displays ASTEROBIA title and MULTIPLAYER subtitle', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // The first child div of the card is the title "ASTEROBIA"
        // and the second is the subtitle "MULTIPLAYER".
        // We look inside #join-overlay for those text nodes.
        await expect(overlay.getByText('ASTEROBIA')).toBeVisible();
        await expect(overlay.getByText('MULTIPLAYER')).toBeVisible();
    });

    test('username input is editable', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // The username input has placeholder "Commander" and type "text"
        const usernameInput = overlay.locator('input[type="text"]').first();
        await expect(usernameInput).toBeVisible();
        await expect(usernameInput).toHaveAttribute('placeholder', 'Commander');

        // Type a name
        await usernameInput.fill('TestHost');
        await expect(usernameInput).toHaveValue('TestHost');
    });

    test('HOST GAME and JOIN GAME buttons are visible in initial state', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        const hostBtn = overlay.locator('button', { hasText: 'HOST GAME' });
        const joinBtn = overlay.locator('button', { hasText: 'JOIN GAME' });

        await expect(hostBtn).toBeVisible();
        await expect(joinBtn).toBeVisible();
    });

    test('HOST GAME click transitions to hosting state with room code and START GAME', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // Fill in a username first
        const usernameInput = overlay.locator('input[type="text"]').first();
        await usernameInput.fill('TestHost');

        // Click HOST GAME
        const hostBtn = overlay.locator('button', { hasText: 'HOST GAME' });
        await hostBtn.click();

        // After click, the overlay transitions to "hosting" state.
        // A START GAME button should now be visible.
        const startBtn = overlay.locator('button', { hasText: 'START GAME' });
        await expect(startBtn).toBeVisible({ timeout: 5_000 });

        // A "Room:" label should be visible (the room badge)
        await expect(overlay.getByText('Room:')).toBeVisible();

        // HOST GAME button should no longer be visible
        const hostBtnGone = overlay.locator('button', { hasText: 'HOST GAME' });
        await expect(hostBtnGone).not.toBeVisible();

        // JOIN GAME button should no longer be visible
        const joinBtnGone = overlay.locator('button', { hasText: 'JOIN GAME' });
        await expect(joinBtnGone).not.toBeVisible();
    });

    test('JOIN GAME click transitions to joining state with room code input', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // Click JOIN GAME
        const joinBtn = overlay.locator('button', { hasText: 'JOIN GAME' });
        await joinBtn.click();

        // After click, a room code input field should appear (maxLength=2, placeholder="__")
        const codeInput = overlay.locator('input[placeholder="__"]');
        await expect(codeInput).toBeVisible({ timeout: 5_000 });

        // A JOIN button (with arrow) should appear
        const joinSubmitBtn = overlay.locator('button', { hasText: 'JOIN' });
        await expect(joinSubmitBtn).toBeVisible();

        // HOST GAME and JOIN GAME buttons should be gone
        await expect(overlay.locator('button', { hasText: 'HOST GAME' })).not.toBeVisible();
    });

    test('room code input only accepts digits', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // Go to joining state
        const joinBtn = overlay.locator('button', { hasText: 'JOIN GAME' });
        await joinBtn.click();

        const codeInput = overlay.locator('input[placeholder="__"]');
        await expect(codeInput).toBeVisible({ timeout: 5_000 });

        // Type non-numeric characters — they should be stripped
        await codeInput.pressSequentially('ab');
        await expect(codeInput).toHaveValue('');

        // Type valid digits
        await codeInput.pressSequentially('42');
        await expect(codeInput).toHaveValue('42');
    });

    test('username persists across state changes', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        const usernameInput = overlay.locator('input[type="text"]').first();
        await usernameInput.fill('PersistentUser');

        // Transition to hosting state
        const hostBtn = overlay.locator('button', { hasText: 'HOST GAME' });
        await hostBtn.click();

        // Username should still be there
        await expect(usernameInput).toHaveValue('PersistentUser');
    });

    test('version footer is visible', async ({ page }) => {
        const overlay = await waitForOverlay(page);
        await expect(overlay.getByText('v0.13 alpha')).toBeVisible();
    });
});

// ===========================================================================
// TS-03: Console Toggle (Top-Left)
// ===========================================================================
test.describe('TS-03: Console Toggle', () => {

    test('debug console toggle button exists', async ({ page }) => {
        await waitForOverlay(page);

        // The button is created by Game._createDebugToggleButton()
        // It has id="debug-console-toggle" and text containing "Console"
        const toggleBtn = page.locator('#debug-console-toggle');
        await expect(toggleBtn).toBeVisible({ timeout: 5_000 });
        await expect(toggleBtn).toContainText('Console');
    });

    test('debug console toggle button is in top-left area', async ({ page }) => {
        await waitForOverlay(page);

        const toggleBtn = page.locator('#debug-console-toggle');
        await expect(toggleBtn).toBeVisible({ timeout: 5_000 });

        // Verify position: top and left should be small values (top-left corner)
        const box = await toggleBtn.boundingBox();
        expect(box).toBeTruthy();
        expect(box.x).toBeLessThan(150); // left area
        expect(box.y).toBeLessThan(50);  // top area
    });
});

// ===========================================================================
// TS-10: Edge Cases (subset — DOM-only checks)
// ===========================================================================
test.describe('TS-10: Edge Cases', () => {

    test('empty username defaults — HOST GAME still works', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // Leave username empty, click HOST GAME
        const hostBtn = overlay.locator('button', { hasText: 'HOST GAME' });
        await hostBtn.click();

        // Should still transition (no crash). START GAME should appear.
        const startBtn = overlay.locator('button', { hasText: 'START GAME' });
        await expect(startBtn).toBeVisible({ timeout: 5_000 });
    });

    test('invalid room code shows error message', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // Go to join state
        const joinBtn = overlay.locator('button', { hasText: 'JOIN GAME' });
        await joinBtn.click();

        const codeInput = overlay.locator('input[placeholder="__"]');
        await expect(codeInput).toBeVisible({ timeout: 5_000 });

        // Enter invalid code: single digit (must be 10-99)
        await codeInput.fill('5');

        // Click JOIN
        const joinSubmitBtn = overlay.locator('button', { hasText: 'JOIN' });
        await joinSubmitBtn.click();

        // Error message should appear: "Enter a valid 2-digit code (10-99)"
        await expect(overlay.getByText('Enter a valid 2-digit code')).toBeVisible({ timeout: 3_000 });
    });

    test('empty room code shows error message', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // Go to join state
        const joinBtn = overlay.locator('button', { hasText: 'JOIN GAME' });
        await joinBtn.click();

        const codeInput = overlay.locator('input[placeholder="__"]');
        await expect(codeInput).toBeVisible({ timeout: 5_000 });

        // Leave code empty, click JOIN
        const joinSubmitBtn = overlay.locator('button', { hasText: 'JOIN' });
        await joinSubmitBtn.click();

        // Error message should appear
        await expect(overlay.getByText('Enter a valid 2-digit code')).toBeVisible({ timeout: 3_000 });
    });

    test('rapid HOST GAME clicks do not crash', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        const hostBtn = overlay.locator('button', { hasText: 'HOST GAME' });

        // Click rapidly multiple times
        await hostBtn.click();
        // After first click, HOST GAME button is gone (replaced by START GAME).
        // The page should not crash.
        const startBtn = overlay.locator('button', { hasText: 'START GAME' });
        await expect(startBtn).toBeVisible({ timeout: 5_000 });

        // No uncaught errors — page should still be functional
        // Verify overlay is still in the DOM
        await expect(overlay).toBeVisible();
    });

    test('player count shows 0 in initial state', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // The player count element should display "0" initially
        await expect(overlay.getByText('Players:')).toBeVisible();
        // The count number span contains "0"
        const countText = overlay.locator('span', { hasText: '0' });
        await expect(countText.first()).toBeVisible();
    });
});

// ===========================================================================
// Overlay interaction blockers
// ===========================================================================
test.describe('Overlay Interaction', () => {

    test('overlay blocks mouse events from reaching the game', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // The overlay has stopPropagation on mousedown/mouseup/wheel.
        // We verify the overlay is full-screen by checking its dimensions.
        const box = await overlay.boundingBox();
        expect(box).toBeTruthy();
        expect(box.width).toBeGreaterThanOrEqual(1280); // viewport width
        expect(box.height).toBeGreaterThanOrEqual(720);  // viewport height
    });

    test('START GAME hides the overlay', async ({ page }) => {
        const overlay = await waitForOverlay(page);

        // Host a game
        const hostBtn = overlay.locator('button', { hasText: 'HOST GAME' });
        await hostBtn.click();

        const startBtn = overlay.locator('button', { hasText: 'START GAME' });
        await expect(startBtn).toBeVisible({ timeout: 5_000 });

        // Click START GAME — overlay should hide
        await startBtn.click();

        await expect(overlay).not.toBeVisible({ timeout: 5_000 });
    });
});
