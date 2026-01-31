/**
 * Asterobia Local Configuration Template
 *
 * SETUP (5 steps for non-programmers):
 * 1. Copy this file → public/config.js
 * 2. Go to Supabase Dashboard → Settings → API
 * 3. Copy "Project URL" → paste below (replace YOUR_PROJECT_ID.supabase.co)
 * 4. Copy "anon public" key → paste below (replace YOUR_ANON_KEY_HERE)
 * 5. Save, then refresh game page
 *
 * SECURITY: Only use "anon" key. NEVER use "service_role" key.
 * The anon key is safe for frontend. config.js is gitignored.
 */
window.ASTEROBIA_CONFIG = window.ASTEROBIA_CONFIG || {};

window.ASTEROBIA_CONFIG.supabase = {
    url: "https://YOUR_PROJECT_ID.supabase.co",
    key: "YOUR_ANON_KEY_HERE"
};

// Config loaded marker (checked by dev HUD)
window.ASTEROBIA_CONFIG._loaded = true;
