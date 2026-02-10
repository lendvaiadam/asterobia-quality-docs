/**
 * Asterobia Local Configuration (HU-TEST)
 *
 * INSTRUCTIONS:
 * 1. Rename this file to 'config.js' (inside public/ folder)
 * 2. Replace the placeholders below with your credentials.
 * 3. Restart the game page.
 * 
 * NOTE: 'public/config.js' is gitignored. Your secrets will stay local.
 */
window.ASTEROBIA_CONFIG = window.ASTEROBIA_CONFIG || {};

window.ASTEROBIA_CONFIG.supabase = {
    // Copy "Project URL" from Supabase -> Settings -> API
    url: "https://PUT_YOUR_PROJECT_ID_HERE.supabase.co",

    // Copy "anon public" key from Supabase -> Settings -> API
    // WARNING: NEVER use the 'service_role' key here.
    key: "PUT_YOUR_ANON_KEY_HERE"
};

console.log('[Config] Local Supabase config loaded.');
