# STATUS_WALKTHROUGH — Live Project State
Purpose: This is the living walkthrough of "where we are now", what is next, and who is doing what.
Stable rules live in docs/START_HERE.md. Canonical specs are indexed elsewhere.

Last updated: 2026-02-01 (Europe/Budapest)

---

## Current baseline
- Stable starting ref: baseline/pre-claude-stable
- Canonical index (stable): https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/baseline/pre-claude-stable/docs/CANONICAL_SOURCES_INDEX.md
- Preflight: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/baseline/pre-claude-stable/quality/NETCODE_PREFLIGHT.md

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

## Release Status (Completed/In-Flight)

### Release 001: Fixed Timestep Authority — DONE
- **Branch**: `work/r001-determinism-wiring` (merged to main)
- **Commits**: SimLoop.js (50ms tick), Game.js simTick/renderUpdate split
- **HU Test**: PASS (2026-01-28)

### Release 002: Command Buffer Shim — DONE
- **Branch**: `work/r002-command-buffer`
- **Commits**: `2f3a1d0..9a8b11e` (9 commits)
- **Head**: `9a8b11e` r002: add CommandDebugOverlay for queue inspection
- **Raw link**: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/work/r002-command-buffer/src/SimCore/commands/index.js
- **HU Test**: PASS (2026-01-29)

### Release 003: Deterministic IDs — DONE
- **Branch**: `work/r003-deterministic-ids` (merged to main)
- **Head**: `21750f4` r003: implement deterministic entity ID generation
- **Raw link**: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/work/r003-deterministic-ids/src/SimCore/runtime/IdGenerator.js
- **HU Test**: PASS (2026-01-29)

### Release 004: Seeded RNG (Deterministic PRNG) — DONE
- **Branch**: `work/r004-seeded-rng` (merged to main)
- **Head**: `8a2cc60` r004: implement seeded PRNG (Mulberry32) for determinism
- **Raw link**: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/work/r004-seeded-rng/src/SimCore/runtime/SeededRNG.js
- **HU Test**: PASS (2026-01-29)

### Release 005: State Surface Definition (serializeState) — DONE
- **Branch**: `work/r005-state-surface` (merged to main)
- **Head**: `76eb176` r005: implement authoritative StateSurface and serialization
- **Raw link**: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/work/r005-state-surface/src/SimCore/runtime/StateSurface.js
- **HU Test**: PASS (2026-01-29)

### Release 006: Input Factory (Command Abstraction) — DONE
- **Branch**: `work/r006-input-factory` (merged to main)
- **Status**: DONE

### Release 007: Local Transport Shim — DONE
- **Objective**: Define `ITransport` and `LocalTransport` (loopback).
- **Status**: **DONE**.
- **Ref**: `docs/RELEASE_PLAN.md` (Release 007).

### Release 008: Snapshot Interpolation (Verify & Tune) — DONE
- **Objective**: Verify render interpolation sufficiency; Fix Stutter Bug.
- **Status**: **DONE** (SHA: 4cd448d).

### Release 009: Pathfinding Determinism — DONE
- **Objective**: Ensure pathfinding runs strictly inside `SimCore.step`.
- **Status**: **DONE** (SHA: 3d3cf42).

### Release 010: Full Determinism Verification — DONE
- **Objective**: Prove determinism via dual-run hash match.
- **Status**: **DONE** (SHA: eeb1bf1).

### Release 011: Save/Load System — DONE (SHA: 60ccf73)
- **Objective**: Implement save/load via `LocalTransport` and persistence.
- **HU Protocol**: Use `?dev=1` or `#dev=1` to enable HUD.
- **Ref**: `docs/RELEASE_PLAN.md` (Release 011).

### Release 012: Supabase HUD & Config — DONE
- **Objective**: HUD + Config for Supabase.
- **Status**: **DONE** (SHA: 80b511a).
- **Ref**: `docs/RELEASE_PLAN.md` (Release 012).

---

## NOW (Immediate Actions)

### Step 1: Consultation Round (Mandatory)
- **Action**: ChatGPT must ask Agents (Antigravity + CC1 + CC2) for their recommendations on **R013 Micro-step 1**.
- **Objective**: Define the exact implementation path for the Host-Authority Handshake skeleton.
- **Constraint**: Must be merge-safe and preserve existing determinism.

### Step 2: Decision Packet
- **Action**: ChatGPT synthesizes feedback into a structured decision packet for Ádám.
- **Output**: `docs/DECISIONS/R013_MICRO_STEP_1.md` (Proposal for approval).

### Target: Release 013 (Multiplayer Handshake)
- **Objective**: Implement the Host-Authority Handshake protocol.
- **Spec**: `docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md`
- **Schema**: `docs/specs/R013_DB_SCHEMA_OPTIONAL.md`
- **Status**: **Ready for Implementation** (Docs Merged).

---

## Who is doing what (roles)
- Ádám: Hungarian ideas + decisions + testing + relaying messages between AIs (no Git ops).
- Agents (Antigravity/Claude): branches/PRs, push changes, merge to main after Ádám explicit approval.
- Antigravity (Gemini): audits, repo mapping, preflight checks, doc snapshots (no deep refactors unless asked).
- Claude Code: implements code PRs per canonical Phase 0 rules.
- ChatGPT: writes prompts + checks plans against canonical docs.

---

## Blockers / Decisions needed from Ádám
- Approval of R013 Decision Packet (once generated).

---

## How to resume (new chat window)
1) Open docs/CHATGPT_OPENING_PACK.md and paste the "COPY/PASTE INTO A NEW CHAT" block.
2) Read docs/STATUS_WALKTHROUGH.md + docs/MAILBOX.md.
3) Read your agent notes file (docs/NOTES_*.md).
4) Continue from the top item in NOW.

---

## Release Registry
- **Manifest**: [public/versions.json](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/public/versions.json)
- **Release Plan**: [docs/RELEASE_PLAN.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/RELEASE_PLAN.md)
