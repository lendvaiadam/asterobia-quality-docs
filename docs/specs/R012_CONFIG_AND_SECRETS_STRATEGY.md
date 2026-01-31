# R012: Config & Secrets Strategy

**Objective**: Secure management of Supabase credentials across Development and Production environments.

---

## 1. Strategy Overview

### A. The Core Rule
**"The Client is Untrusted."**
- We NEVER ship `service_role` (secret) keys to the client.
- The Client uses the `anon` (public) key for all requests.
- **Row Level Security (RLS)** in Postgres is the *only* security boundary.

### B. Dev vs. Prod Flow

| Environment | Config Source | Key Type | Access Control |
| :--- | :--- | :--- | :--- |
| **Development** | `public/config.js` | Anon (Public) | RLS + `dev` flag |
| **Production** | Build-time Env / Server Injection | Anon (Public) | RLS + Auth |

### C. Security Model
1.  **Transport**: HTTPS (Supabase handles this).
2.  **Auth**:
    - **R012 (Phase 1)**: Anonymous Auth (ID generation on server).
    - **Future**: Email/Social Auth.
3.  **Data Access**: RLS Policies restrict `SELECT`/`INSERT`/`UPDATE` to `auth.uid() = owner_id`.
4.  **Admin Ops**: performed via Supabase Dashboard or Edge Functions (using Service Role), NOT from the Game Client.

---

## 2. Dev Implementation (Localhost)

For local development with `http-server`, we use a runtime configuration file.

### File Structure
- `public/config.js.template`: Committed. Empty placeholders.
- `public/config.js`: **Gitignored**. Contains your actual `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

### Injection
`game.html` loads `config.js` before `Main.js`.
```html
<script src="public/config.js"></script>
```
Script populates `window.ASTEROBIA_CONFIG`.

### Startup Check
If `public/config.js` is missing (404), the game:
1.  Warns in Console.
2.  Defaults to `LocalTransport`.
3.  Shows "CONFIG ERROR" or "NET: LOCAL" in the HUD.

---

## 3. Operational Gates & Validation

### A. CI / Build Check
- Grep source code for regex `sbp_ex` (possible Service Role pattern) or known secret patterns.
- Fail build if secrets detected.

### B. Runtime Assertion (The "Fail Fast" Gate)
In `Game.js`, before connecting:
1.  Decode the `SUPABASE_ANON_KEY` (JWT).
2.  Inspect the `{ role }` claim.
3.  **ASSERT**: `role === 'anon'`.
4.  **IF FAIL**:
    - Abort connection.
    - Flash RED HUD: **"SECURITY RISK: SERVICE KEY DETECTED"**.
    - Log error (masking the key).

### C. HUD Indicator States
- **NET: SUPABASE** (Green): Connected, Anon Key valid.
- **NET: LOCAL** (Grey): Config missing or `net` param not set.
- **CONFIG ERROR** (Red): Config present but partial/malformed.
- **KEY INVALID** (Red): JWT decode failed or Role != anon.

---

## 4. Out of Scope (R012)
- Server-side lobby logic.
- Anti-cheat validation (authoritative server is R013/R014).
- Full Persistent World Deltas (current is snapshot-only).
