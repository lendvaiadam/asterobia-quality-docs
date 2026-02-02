# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Asterobia is a spherical-planet RTS game. This repository combines quality documentation with game code (the code will migrate to a separate repo after Phase 0).

**Current priority:** Phase 0 "Netcode Readiness" — deterministic, host-authoritative architecture.

## Development Commands

```bash
# Start development server (http://localhost:8081)
npm start

# Determinism regression suite (run before any merge touching SimCore)
node --experimental-vm-modules src/SimCore/__tests__/transport.test.js
node --experimental-vm-modules src/SimCore/__tests__/inputFactory.test.js
node --experimental-vm-modules src/SimCore/__tests__/pathfinding-determinism.test.js
node --experimental-vm-modules src/SimCore/__tests__/stateSurface.test.js
node --experimental-vm-modules src/SimCore/__tests__/r010-full-determinism.test.js
node --experimental-vm-modules src/SimCore/__tests__/r011-save-load.test.js
```

## Architecture

### SimCore (Deterministic Authority)
- Fixed 20Hz tick rate (50ms), not render-FPS-dependent
- All game logic runs through `SimCore.step()` only
- Command pipeline: UI → `InputFactory` → `CommandQueue` → `SimCore.step()`
- Seeded PRNG (`SeededRNG.js`) for all randomness
- Sequential IDs (`IdGenerator.js`) — no `Math.random()` or `Date.now()`
- State surface exports sim-only data (excludes meshes/materials)

### Key Directories
- `src/SimCore/` — Authoritative simulation (runtime/, domain/, transport/, persistence/)
- `src/Core/` — Game orchestration (Game.js, Input.js)
- `src/Entities/Unit.js` — Legacy monolith (avoid deep changes; route through shims)
- `src/World/` — Terrain, physics queries
- `docs/` — Canonical specs and workflow rules

### Transport Abstraction
- `ITransport` interface with `LocalTransport` (single-player) and `SupabaseTransport` (multiplayer)
- All commands flow through transport; render layer is read-only

## Determinism Rules (Non-Negotiable)

Identical inputs must produce identical outputs. Forbidden in SimCore:
- `Date.now()`, `performance.now()` (use tick count)
- `Math.random()` (use `SimCore.rng`)
- `requestAnimationFrame` (use `SimLoop`)
- `clock.getDelta()` (use fixed 50ms tick)

Run `/determinism-scan` to audit for blockers.

## Claude Code Skills

Located in `.claude/skills/`:
- `asterobia-determinism-gate` — Run full regression suite before merges
- `asterobia-input-closure` — Enforce InputFactory usage for all commands
- `asterobia-bug-discipline` — Log bugs to `docs/BUGLIST.md` before fixing

## Session Bootstrap

1. Read `docs/START_HERE.md` (binding rules)
2. Read `docs/STATUS_WALKTHROUGH.md` and execute the `## NOW` section
3. Read `docs/IMPLEMENTATION_GATES.md` (quality gates)
4. Read `docs/NOTES_CLAUDE.md` (Claude-specific guidelines)

## Workflow Rules

- **Testing:** Every code change needs a HU (Human-Usable) test checklist for Ádám
- **Bugs:** Record in `docs/BUGLIST.md` before fixing
- **Commits:** Include RAW GitHub links to changed files + test script
- **Branches:** Name as `prX-<description>` (e.g., `pr013-multiplayer-handshake`)
- **Push Protocol:** All changes must be pushed; local-only is not acceptable

## Lane Scheduling

Actions are assigned to lanes (mutually exclusive within a lane per tick):
- LOCOMOTION: MOVE_ROLL, UNIT_CARRIER
- TOOL: TERRAIN_SHAPING, MATERA_MINING
- WEAPON: WPN_SHOOT
- PERCEPTION: PERCEPTION_SUBSURFACE_SCAN (active)
- No lane: PERCEPTION_OPTICAL_VISION (passive, runs every tick)

## Communication Style

- Concise, engineering-focused
- Skip conversational filler
- Reference exact file paths
- Every reply: what changed + RAW links + what's waiting + test surface
