# STATUS_WALKTHROUGH — Live Project State

**Purpose:** This is the live status dashboard.
**Rules**: Process rules are now in `docs/AI_WORKFLOW.md`.
**Worker Status Key**: `IDLE` | `READY` | `ASSIGNED` (Wait ACK) | `IN-FLIGHT` (Has Artifact) | `BLOCKED` | `HANDOFF`. 
**Do NOT assume 'Already Routed' — Require ACK.**

**Last updated:** 2026-02-04 (Europe/Budapest)

## 👷 Role Map (Active Workers)
| Worker | Specialty | Branch | Work Order | Status |
|---|---|---|---|---|
| W1 | Backend | work/WO-R013-backend | WO-R013-M05 | **READY** |
| W2 | Frontend/UI | - | - | Idle |
| W3 | QA/Test | - | - | Idle |
| W4 | Refactor/Review | - | - | Idle |
| Orchestrator | Coordination | work/WO-R013 | R013 Integration | Active |

**Test Notes (Non-Blocking):**
- **"No test suite found"**: Vitest reports this for custom-runner files. Check file output for "X passed".
- **Flaky Tests**: `sessionState.test.js` is timing-dependent. Acceptable for M06/M07 closure.


---

## 🚀 Release Status (Completed/In-Flight)

### Release 001-006: Phase 0 Foundation — DONE
- **Deterministic Loop**: DONE
- **Command Buffer**: DONE
- **Seeded RNG**: DONE
- **State Surface**: DONE
- **Input Factory**: DONE

### Release 007-011: Phase 0 Polishing — DONE
- **Local Transport**: DONE
- **Snapshot Interpolation**: DONE
- **Pathfinding Determinism**: DONE
- **Determinism Verification**: DONE
- **Save/Load System**: DONE

### Release 012: Supabase HUD & Config — DONE
- **Status**: **DONE** (SHA: 80b511a).
- **Verified**: `savepoint/r012-hud-fix-verified`

---

## ⚡ NOW (Immediate Actions)

### Target: Release 013 (Multiplayer Handshake)
- **Objective**: Implement the Host-Authority Handshake protocol.
- **Spec**: `docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md`
- **Schema**: `docs/specs/R013_DB_SCHEMA_OPTIONAL.md`
- **Completed**: M01, M02, M03, M04, M05 (Guest Lobby Discovery) — MERGED
- **Verified**: M05 HU-TEST PASS (Host appears in list, disappears after 15s prune).
- **Previous Step**: M06 (Join Request Handshake) — **CLOSED** (HU-TEST PASS)
- **Current Step**: M07-NB0 (Phase 0 Scaffolding) — **VERIFIED** (Audit PASS 2026-02-10)
- **Current Step**: **Phase 2A (Option 3: Manifest-Lite)** — **IN PROGRESS**
    - **Goal:** Strict Server Authority, Scale, Flight.
    - [x] **Commit 1 (Server Core)**: `GameServer` Manifest/Flight Fields. **MERGED** (SHA: `801b317`).
    - [x] **Commit 1.1 (Cleanup):** Protocol Test Migration. **MERGED** (SHA: `deba991`).
    - [x] **Commit 2 (Client Wiring):** Client gates spawn, mirrors snapshot. **MERGED** (SHA: `33e230d`).
    - [x] **Commit 3 (Integration)**: End-to-end test.
- [x] **Phase 2A Hardening & Docs:** Security Fixes + Specs. **MERGED** (SHA: `40ea6ec`).
- [x] **Phase 2B (Path-Follow):** Launch. **MERGED** (SHA: `86fb3fd`).
    - **Scope:** Server Path Validation (32 cap), Client A*, WASD Interrupt.
    - **Tests:** 789/789 PASS. HU-PASS Confirmed.
    - **Tests:** 789/789 PASS. HU-PASS Confirmed.
    - **Note:** "Commands" error is pre-existing legacy (Phase 1).
- [x] **Phase 3 PREP:** Tooling + Smoke Tests. **MERGED** (SHA: `bb54e5b`).
    - **Deps:** Rapier `0.19.3` + Simplex `4.0.3` (Pinned).
    - **Tests:** +9 Smoke Tests (Physics). Total 798 PASS.
    - **Docs:** Best Practices Added.
- [x] **Phase 3 Step 1: Foundation (Rapier).** **MERGED** (SHA: `HEAD`).
    - **Scope:** `PhysicsWorld.js` wrapper + `Room.js` integration (Flag-gated).
    - **Flag:** `enablePhysics: false` (Default). No runtime impact yet.
    - **Tests:** +36 Integration Tests. Total 834 PASS.
- [x] **Phase 3 Step 2: Terrain Colliders (JIT).** **MERGED** (SHA: `HEAD`).
    - **Scope:** `TerrainColliderManager.js` (patches, cache, eviction).
    - **Caps:** `maxPatches: 16`. Eviction every 20 ticks.
    - **Tests:** +22 Integration Tests. Total 856 PASS.
- [x] **Phase 3 Step 3: Hybrid Lifecycle.** **MERGED** (SHA: `HEAD`).
    - **Scope:** `HeadlessUnit.js` (Kinematic <-> Dynamic).
    - **Trigger:** API-only / Test-only (No gameplay trigger yet).
    - **Tests:** +29 Integration Tests. Total 885 PASS.
- **CTO Ping #1**: APPROVED (2026-02-10)
- **Skills Infrastructure**: 15 skill files + 4 worker loadouts installed (49fb8ee)
- **Test State**: Vitest installed. 690 tests passed! (Clean).


---

## 🔮 Next Up
- **Release 014**: Matera Transport
- **Release 015**: Weapon System

### M07 (Game Loop) GATES (READY)
- **Status**: **READY**. M06 Handshake verified.
- **Requirement**: `game.stateSurface.serialize()` exists and works (Verified in M06).
- **Next Step**: Implement Game Loop tick synchronization (Resync/Interpolation).
- **API Spec**:
  - `serialize()` -> `{ units: [...], map: {...} }`
  - `deserialize(json)` -> Restores state deterministically.
  - Runtime availability: accessible via `game` object in console.

---

## 📝 Open Decisions / Blockers
*(None currently active)*

## 🔧 Local Supabase Setup (Required for HU-TEST)

**For Operator (Ádám):**
To enable Supabase testing locally, you must provide your project credentials.

1.  **Copy**: Duplicate `public/config.local.example.js` and rename it to `public/config.js`.
2.  **Edit**: Open `public/config.js`.
3.  **Fill**: Paste your **Project URL** and **Anon Key** (from Supabase Dashboard -> Settings -> API).
4.  **Save**: The file is ignored by git. Your secrets are safe.

### Troubleshooting
- **Error**: "Anonymous sign-ins are disabled".
- **Fix**: Go to Supabase Dashboard -> Authentication -> Providers -> **Enable Anonymous Sign-ins**.

---

## 🧪 HU-TEST: R013 M04 Verification (Ádám)

**Teszt célja:** Ellenőrizni, hogy az M04 (Host Lobby + Announce) kód helyesen került integrálásra.

### PRE (Előfeltételek)
- **Supabase Config**: A `public/config.js` fájl létrehozva és kitöltve (lásd fent).
- A repo fel van húzva a `work/WO-R013` branchre
- `npm install` lefutott (ha még nem)
- `npm start` fut (`http://127.0.0.1:8081`)

### STEPS (Lépések)
1. Nyisd meg a DevTools konzolt (F12)
2. Nyisd meg a játékot Supabase módban: `http://127.0.0.1:8081/game.html?dev=1&net=supabase`
3. Ellenőrizd a HUD-ot: "Net: SUPABASE" és "Auth: ANON OK"?
4. Keresd meg a "Host Game" gombot (ha van UI) VAGY
5. Ha nincs UI, a konzolban hívd meg: `game.sessionManager.hostGame('TestSession')`
6. Figyeld a konzol kimenetét

### EXPECTED (Elvárt eredmény)
- A SessionManager állapota: `role = 'HOST'`
- **Bizonyíték (Approved Method)**: `game.sessionManager._debugAnnounceTickCount` növekszik (pl. 1 -> 4).
- A `sessionManager.state.sessionName` értéke: `'TestSession'`

### QUICK PASS/FAIL
- **PASS**: ✅ **VERIFIED (2026-02-04)**. Operator confirmed `_debugAnnounceTickCount` increment via `getDebugNetStatus()`.
- **FAIL**: Hibaüzenet (pl. Auth error) VAGY nincs növekedés.

---
*For workflow rules, see `docs/AI_WORKFLOW.md`*

