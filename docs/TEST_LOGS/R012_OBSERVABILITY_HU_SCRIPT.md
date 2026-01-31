# R012 Observability Test - Human User Script

**Purpose:** Verify R012 Supabase integration is observable without console access.
**Audience:** Non-programmers (no code or console knowledge required)
**Time:** ~2 minutes

---

## Prerequisites

1. Game server running: `npm start` (http://localhost:8081)
2. If testing Supabase: Your `public/config.js` has real Supabase credentials
   - If not configured: you'll see "CONFIG: PLACEHOLDER" (expected)

---

## 5-Step Test Procedure

### Step 1: Open the Dev URL
**Action:** Open this URL in your browser:
```
http://localhost:8081/game.html?net=supabase&dev=1
```

**Expected:** A dark semi-transparent HUD appears in the **top-right corner** with:
- "R012 DEV HUD" header (cyan text)
- NET MODE, CONFIG, AUTH, REALTIME status lines
- Save/Load buttons

---

### Step 2: Check Config Status
**Action:** Look at the CONFIG line in the HUD.

**Expected (if config not set up):**
- `CONFIG: PLACEHOLDER` (red) - Need to edit public/config.js
- `CONFIG: MISSING` (red) - config.js file missing

**Expected (if config is set up):**
- `CONFIG: OK` (green)
- `AUTH: ANON OK` (green)
- `REALTIME: CONNECTED` (green) or `CONNECTING...` (orange)

---

### Step 3: Test Save Button
**Action:**
1. Wait for the game to load (world visible)
2. Click the green **[Save]** button in the HUD

**Expected:**
- The DB status line updates to: `DB: SAVE OK t:XX X.XKB`
- Where XX is tick number, X.X is kilobytes saved
- Text is **green** (success)

---

### Step 4: Test Load Button
**Action:** Click the blue **[Load]** button in the HUD

**Expected:**
- The DB status line updates to: `DB: LOAD OK t:XX X.XKB`
- Text is **green** (success)

---

### Step 5: Hard Refresh & Verify
**Action:** Press Ctrl+F5 (hard refresh) or Shift+Refresh

**Expected:**
- HUD reappears with all status indicators
- If Supabase was connected, REALTIME shows `CONNECTING...` briefly, then `CONNECTED`

---

## Quick Reference: Status Colors

| Status | Color | Meaning |
|--------|-------|---------|
| `OK`, `CONNECTED`, `ANON OK` | Green | Working correctly |
| `CONNECTING...` | Orange | In progress |
| `MISSING`, `PLACEHOLDER`, `FAIL`, `ERROR` | Red | Needs attention |
| `N/A` | Gray | Not applicable (Local mode) |

---

## Result

- [ ] **PASS** - All indicators visible and responsive
- [ ] **FAIL** - (Describe what's missing/broken below)

**Failure Notes:**
```
[Write any issues observed here]
```

---

## Troubleshooting

| HUD Shows | Likely Cause | Fix |
|-----------|--------------|-----|
| No HUD visible | Missing `?dev=1` in URL | Add `&dev=1` to URL |
| `CONFIG: PLACEHOLDER` | Using example values | Copy real credentials to public/config.js |
| `CONFIG: SERVICE_ROLE!` | Wrong key type | Use "anon public" key, not service_role |
| `REALTIME: ERROR` | Network/credential issue | Check Supabase dashboard, verify URL/key |
| `AUTH: FAIL` | Invalid JWT | Regenerate anon key from Supabase dashboard |
