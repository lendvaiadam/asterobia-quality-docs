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
    url: "https://vbbehmzvhwmaicpeynas.supabase.co",

    // Copy "anon public" key from Supabase -> Settings -> API
    // WARNING: NEVER use the 'service_role' key here.
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiYmVobXp2aHdtYWljcGV5bmFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4ODU4OTUsImV4cCI6MjA4NTQ2MTg5NX0.IFmGGHUvbrzQDIePSVRY3sWagTfIZnmGcmc6Gl3TjDk"
};

console.log('[Config] Local Supabase config loaded.');
