# R013 Progress Tracker
> Last updated: 2026-02-08

## Milestone Summary

### M01-M05: Foundation (COMPLETE)
- Supabase transport layer
- Lobby channel + HOST_ANNOUNCE
- Session channel + JOIN_REQ/ACK
- Game state snapshot serialization

### M06: Join Flow (COMPLETE)
- Host/Guest join handshake
- Snapshot transfer on join
- 32 automated tests

### M07: Unit Authority + Seat System (COMPLETE)
- selectedBySlot + ownerSlot model
- SEAT_REQ/ACK/REJECT/RELEASE flow
- PIN validation (1-digit keypad)
- Owner re-entry bypass
- Tab filtering by ownerSlot (last-sat-wins)
- Lock/Occupied indicators with player names
- 8 ownership model tests

### M07.5: Join UI + Game Infrastructure (COMPLETE)
- JoinOverlay v2: single-screen with in-place transforms
- MultiplayerHUD: top-right status display
- Console toggle + consolidation
- SeatKeypadOverlay: ESC close + X button + focus trap
- Host-leave resilience + host migration
- HOST_LEAVE / GUEST_LEAVE message types
- Slice 2: ENABLE_COMMAND_EXECUTION = true
- StateHash sampling (every 60 ticks)
- Indicator sprites: depthTest for planet occlusion
- Console log discipline (56 logs wrapped)
- ~160 lines dead code removed
- 29 host-leave tests

### Current Stats
- **Tests**: 514/514 PASS (24 test files)
- **Branch**: `work/r013-buglist-docs`
- **Test Scenarios**: 10 scenarios documented (docs/TEST_SCENARIOS_R013_M07.md)
- **Playwright E2E**: 16 smoke tests (tests/e2e/join-flow.pw.js)
- **Manual Testing**: PENDING (TS-01 through TS-10)
- **Bugs Fixed This Session**: D4, A5, C1, C2 (tinting), H7 (Slice 2), FOW wired

---

## What's Next

### Immediate (needs manual test first)
- [ ] Run TS-01 through TS-10 in browser
- [ ] Fix any bugs found during manual testing

### M08: Determinism Hardening (COMPLETE)
- [x] Fix CRITICAL #1: Date.now() in TypeBlueprint → tick parameter
- [x] Fix CRITICAL #2: Date.now() in UnitTypeBinder boundAt → tick parameter
- [x] Fix CRITICAL #3: Date.now() in Store default state → 0
- [x] Fix CRITICAL #4: InteractionManager path mutations documented as safe-by-design (drag-release only)
- [x] Fix CRITICAL #5: ownerSlot/seat mutations documented as safe-by-design (authority model)
- [x] Fix WARNING: A* tie-breaking (compare node index when fScores equal)
- [x] Fix WARNING: Tick-based throttle in PathPlanner
- [x] Fix WARNING: Seat cooldowns use simTick not Date.now()
- [x] Playwright e2e smoke test scaffold (16 tests)

### M09: FOW (Fog of War) Per Controlled Unit (IN PROGRESS)
- [x] FogOfWar.js: Grid-based per-player fog system (3 states: UNSEEN/EXPLORED/VISIBLE)
- [x] FogRenderer.js: Three.js DataTexture overlay for visual rendering
- [x] Vision sharing: shareVision()/unshareVision() for ally integration
- [x] Wired into Game.js: simTick (every 5 ticks) + renderUpdate (FogRenderer)
- [x] Grid params: 100x100, cellSize=2, origin=(-100,-100), visionRadius=15
- [x] Owner tinting: emissive glow per ownerSlot (Blue/Red/Green/Yellow)
- [x] 59 FOW tests (37 unit + 22 integration)
- [ ] Unit visionRadius property per unit type
- [ ] FOW path planning integration (D3/E1-E3 bugs)
- [ ] FOW sharing UI toggle

### M10: Full Gameplay Loop
- [ ] Victory/defeat conditions
- [ ] Resource system
- [ ] Combat/interaction

---

## Architecture Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-07 | selectedBySlot + ownerSlot model | Separate "who's driving" from "who owns" |
| 2026-02-07 | Last-sat-wins ownership | Simple, no negotiation needed |
| 2026-02-08 | SELECT/DESELECT bypass transport | UI-only, no need for network round-trip |
| 2026-02-08 | Single-screen JoinOverlay | Better UX than 3 separate screens |
| 2026-02-08 | Host migration on disconnect | Game continues without Host |
| 2026-02-08 | stateHash sampling every 60 ticks | Balance between detection speed and performance |
| 2026-02-08 | Date.now() → simTick for determinism | All time-dependent state uses sim tick, not wall clock |
| 2026-02-08 | A* tie-breaking by node index | Prevent platform-dependent path selection |
| 2026-02-08 | Playwright .pw.js extension | Separate from Vitest (.test.js) to avoid runner conflict |
