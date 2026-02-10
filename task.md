# Task: R013 Multiplayer & Game Loop Integration

**Last Updated:** 2026-02-09
**Status:** Slice 1 (Transport) COMPLETE, Slice 2 (Execution) IN PROGRESS
**Branch:** `work/WO-R013`
**Reference:** `docs/prompts/ANTIGRAVITY_BRIEFING_2026-02-09.md`

---

## Phase 1: Specifications & Baseline (COMPLETE)
- [x] **Spec**: `docs/specs/R013_M07_GAME_LOOP.md` (Locked)
- [x] **Repo**: `task.md`, `implementation_plan.md` exist
- [x] **HU-TEST Template**: `docs/TEST_LOGS/HU-TEST-R013-M07-LOOP.md` created

---

## Phase 2: Slice 1 (Transport & Authority) (COMPLETE)
**Goal**: Reliable command transport, exclusive seating, UI.

- [x] **Transport**: `MessageSerializer`, `SessionManager` (CMD_BATCH, SEAT_REQ/ACK)
- [x] **Host Migration**: Auto-host assignment on leave, timeout detection
- [x] **Unit Authority**: `selectedBySlot`, `ownerSlot`, `ownerHistory`
- [x] **Seating Logic**: PIN system, Keypad UI, Occupied check
- [x] **UI & HUD**: JoinOverlay v2, Multiplayer HUD, Debug Console
- [x] **Guest Spawn**: Auto-spawn unit and camera focus

---

## Phase 3: Slice 2 (Execution & Hardening) (IN PROGRESS)
**Goal**: Deterministic execution, strict networking, FOW.

### 3.1 Network Hardening
- [ ] **Strict Gap Policy**:
    - [ ] Detect missing `batchSeq`
    - [ ] Stall simulation
    - [ ] Send `RESEND_REQ`
    - [ ] Resume on fill
- [ ] **Active StateHash**:
    - [ ] Host sends hash in `CMD_BATCH`
    - [ ] Guest compares -> Trigger RESYNC on mismatch

### 3.2 Feature Updates
- [ ] **FOW Per-User**:
    - [ ] Refactor `FogOfWar.js` for per-slot tracking
    - [ ] Update shader to mix distinct vision sources
- [ ] **Movement Interpolation**:
    - [ ] Smooth visual updates for remote units (between ticks)

### 3.3 Bug Fixes (From Briefing)
- [ ] **A1**: `startDiscovery()` UI missing
- [ ] **A3**: Join timeout race condition
- [ ] **C1**: Relative waypoints (verify fix)
- [ ] **C2**: Unit visual distinction (Owner Tinting/Glow)
- [ ] **D3**: Pathfinding through unknown obstacles
- [ ] **D4**: Waypoint dots visibility
- [ ] **G1**: Dust particle memory leak

---

## Phase 4: Verification & Testing
- [ ] **Dual-Client Test**: Manual verification of movement/state sync
- [ ] **Latency Test**: Verify stall/predition under lag
- [ ] **Stress Test**: 4 players (simulated if needed)

---

## Worker Assignment
| Worker | Topic | Tasks |
|--------|-------|-------|
| BE | Networking | Strict Gap Policy, StateHash Logic |
| GFX | Visuals | FOW Per-User, Owner Tinting (C2) |
| UI | Interface | Discovery UI (A1), Waypoint Dots (D4) |
| QA | Testing | Manual Dual-Client, Latency Checks |
