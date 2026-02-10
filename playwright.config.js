// @ts-check
import { defineConfig } from '@playwright/test';

/**
 * Playwright config for Asterobia E2E smoke tests.
 *
 * The game is served by http-server on port 8081.
 * Launch with:  npm run start   (serves on http://localhost:8081)
 * Run tests:    npx playwright test
 *
 * NOTE: Supabase-dependent tests may fail gracefully if the backend
 * is not configured — that is expected.  The DOM/UI presence checks
 * will still pass as long as the page loads.
 */
export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.pw.js',

    /* Maximum time one test can run */
    timeout: 30_000,

    /* Expect assertions timeout */
    expect: {
        timeout: 10_000,
    },

    /* Fail the build on CI if you accidentally left test.only in the source */
    forbidOnly: !!process.env.CI,

    /* Retry once on CI, never locally */
    retries: process.env.CI ? 1 : 0,

    /* Reporter */
    reporter: process.env.CI ? 'dot' : 'list',

    use: {
        /* Base URL — game.html served by http-server on port 8081 */
        baseURL: 'http://localhost:8081',

        /* Run headless by default; flip to false for local debugging */
        headless: true,

        /* Capture screenshot on failure */
        screenshot: 'only-on-failure',

        /* Collect trace on first retry */
        trace: 'on-first-retry',

        /* Viewport — keep it reasonable for the game canvas */
        viewport: { width: 1280, height: 720 },
    },

    /* Web server — automatically start http-server before tests */
    webServer: {
        command: 'npx http-server . -c-1 -p 8081',
        port: 8081,
        reuseExistingServer: !process.env.CI,
        timeout: 15_000,
    },
});
