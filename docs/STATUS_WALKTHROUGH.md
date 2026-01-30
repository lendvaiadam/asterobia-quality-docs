# STATUS_WALKTHROUGH — Live Project State
Purpose: This is the living walkthrough of "where we are now", what is next, and who is doing what.
Stable rules live in docs/START_HERE.md. Canonical specs are indexed elsewhere.

Last updated: 2026-01-29 (Europe/Budapest)

---

## Current baseline
- Stable starting ref: baseline/pre-claude-stable
- Canonical index (stable): https://raw.githubusercontent.com/lendvaiadam/asterobia/baseline/pre-claude-stable/docs/CANONICAL_SOURCES_INDEX.md
- Preflight: https://raw.githubusercontent.com/lendvaiadam/asterobia/baseline/pre-claude-stable/quality/NETCODE_PREFLIGHT.md

---

## Direction (what we are building toward)
Phase 0 "Netcode Readiness" (binding):
- Fixed-timestep authority loop (no dt-based authority).
- Command-stream input only.
- Deterministic IDs + seeded PRNG.
- Authoritative snapshot surface export.
- ITransport abstraction (Local now, later multiplayer/backend).

Multiplayer target:
- Host-authoritative as MVP; backend Phase 1 = Auth + Lobby/Signaling.

---

## Release Status

### Release 001: Fixed Timestep Authority — DONE
- **Branch**: `work/r001-determinism-wiring` (merged to main)
- **Commits**: SimLoop.js (50ms tick), Game.js simTick/renderUpdate split
- **HU Test**: PASS (2026-01-28)

### Release 002: Command Buffer Shim — DONE
- **Branch**: `work/r002-command-buffer`
- **Commits**: `2f3a1d0..9a8b11e` (9 commits)
- **Head**: `9a8b11e` r002: add CommandDebugOverlay for queue inspection
- **Raw link**: https://raw.githubusercontent.com/lendvaiadam/asterobia/work/r002-command-buffer/src/SimCore/commands/index.js
- **HU Test**: PASS (2026-01-29)
  - Command flow: tick/seq stamping verified (no nulls)
  - Determinism tests: 5/5 PASS
  - Debug overlay: Shift+C toggle working

---

## NOW
### Release 003: Deterministic IDs — DONE
- **Branch**: `work/r003-deterministic-ids` (merged to main)
- **Commits**: `8ed2aba..21750f4`
- **Head**: `21750f4` r003: implement deterministic entity ID generation
- **Raw link**: https://raw.githubusercontent.com/lendvaiadam/asterobia/work/r003-deterministic-ids/src/SimCore/runtime/IdGenerator.js
- **HU Test**: PASS (2026-01-29)
  - `game.units.map(u => u.id)` -> integers confirmed
  - `idGenerator.test.js` -> 5/5 PASS

---

### Release 004: Seeded RNG (Deterministic PRNG) — DONE
- **Branch**: `work/r004-seeded-rng` (merged to main)
- **Commits**: `dfb8043..8a2cc60`
- **Head**: `8a2cc60` r004: implement seeded PRNG (Mulberry32) for determinism
- **Raw link**: https://raw.githubusercontent.com/lendvaiadam/asterobia/work/r004-seeded-rng/src/SimCore/runtime/SeededRNG.js
- **HU Test**: PASS (2026-01-29)
  - `seededRNG.test.js` -> 8/8 PASS
  - `TypeBlueprint` fallback patched to use SeededRNG (deterministic)

**Determinism Consolidation Pass — DONE**
- **Branch**: `work/determinism-consolidation` (merged to main)
- **Head**: `d59cc58`
- **Summary**: `Game.js` A-class RNG fixes applied (3); B-class visuals audited.

**E2E Determinism Test — PASS**
- **File**: [src/SimCore/__tests__/e2e-determinism.test.js](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/src/SimCore/__tests__/e2e-determinism.test.js)
- **Command**: `node --experimental-vm-modules src/SimCore/__tests__/e2e-determinism.test.js`
- **Result**: PASSED (Identical states across 2 instances)

---

### Release 005: State Surface Definition (serializeState) — DONE
- **Branch**: `work/r005-state-surface` (merged to main)
- **Commits**: `76eb176`
- **Head**: `76eb176` r005: implement authoritative StateSurface and serialization
- **Raw link**: https://raw.githubusercontent.com/lendvaiadam/asterobia/work/r005-state-surface/src/SimCore/runtime/StateSurface.js
- **HU Test**: PASS (2026-01-29)
  - `stateSurface.test.js` -> 8/8 PASS
  - Determinism Audit: PASS (No `Math.random` / `Date.now`, strict `toFixed(6)` precision)

### Release 006: Input Factory (Command Abstraction) — DONE
- **Branch**: `work/r006-input-factory` (merged to main)
- **Status**: DONE (Renumbered later releases in RELEASE_PLAN)
- **Follow-up**:
  - **Overlay Focus Fix**: `work/r006-overlay-focus-fix` (merged) - HU PASS
  - **Render Interpolation**: `work/r006-render-interpolation` (merged) - HU PASS (Visual smoothing)

### Release 007: ... (See RELEASE_PLAN for next steps)

---

## Who is doing what (roles)
- Ádám: Hungarian ideas + decisions + testing + relaying messages between AIs (no Git ops).
- Agents (Antigravity/Claude): branches/PRs, push changes, merge to main after Ádám explicit approval.
- Antigravity (Gemini): audits, repo mapping, preflight checks, doc snapshots (no deep refactors unless asked).
- Claude Code: implements code PRs per canonical Phase 0 rules.
- ChatGPT: writes prompts + checks plans against canonical docs.

---

## Blockers / Decisions needed from Ádám
- (none currently)

---

## How to resume (new chat window)
1) Open docs/CHATGPT_OPENING_PACK.md and paste the "COPY/PASTE INTO A NEW CHAT" block.
2) Read docs/STATUS_WALKTHROUGH.md + docs/MAILBOX.md.
3) Read your agent notes file (docs/NOTES_*.md).
4) Continue from the top item in NOW.

---

## Release Registry
- **Manifest**: [public/versions.json](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/public/versions.json)
- **Release Plan**: [docs/RELEASE_PLAN.md](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/RELEASE_PLAN.md)
- **Current target release**: Release 005 (Input Factory)
