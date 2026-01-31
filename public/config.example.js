/**
 * Asterobia Local Configuration
 * COPY this file to 'config.js' and fill in your secrets.
 * DO NOT commit 'config.js' to git.
 */
window.ASTEROBIA_CONFIG = window.ASTEROBIA_CONFIG || {};

window.ASTEROBIA_CONFIG.supabase = {
    // URL from Supabase Dashboard > Settings > API
    url: "YOUR_SUPABASE_URL",
    
    // ANON Public Key (Safe to expose in client)
    key: "YOUR_SUPABASE_ANON_KEY"
};
