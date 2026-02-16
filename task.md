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

## Phase 3: Physics & Deformation (IN PROGRESS)
**Goal**: Hybrid kinematic/dynamic movement, spherical gravity, destruction.

### 3.1 Physics Foundation (COMPLETE)
- [x] **Rapier Integration**: `PhysicsWorld.js` (WASM, Fixed Timestep)
- [x] **Gravity Audit**: Confirmed custom spherical force method (Zero Global Gravity)
- [x] **Terrain Colliders**: `TerrainColliderManager.js` (Dynamic patching)
- [x] **Hybrid Unit**: `HeadlessUnit.js` (Kinematic <-> Dynamic transitions)
- [x] **Tooling**: `CMD_ADMIN` debug commands (Explosion, Mine, Rock)
- [ ] **Lift Before Solid Fix**: Implement "Option 1" (lift unit before enabling physics) to prevent spawn ejection

### 3.2 Physics Visualization (IN PROGRESS)
- [x] **Visual Sync (Core)**: `HeadlessUnit.js` rotation sync + `Game.js` dynamic application
- [ ] **Visual Sync (Debris)**: Client-side visual debris for explosions
- [ ] **Host Loop**: Enable physics interpolation on Host client
- [ ] **Debris**: Client-side visual debris for explosions
- [ ] **Atmosphere**: Physically based scattering (Hillaire/O'Neil) for ground/space transitions

## Phase 4: Slice 2 (Execution & Hardening) (PENDING)
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
