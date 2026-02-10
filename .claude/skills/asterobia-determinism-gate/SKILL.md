---
name: asterobia-determinism-gate
description: Enforce determinism checks and Algorithm-Over-AI verification before merges.
---

# Asterobia Determinism Gate Skill

## When to use
- Before ANY merge related to SimCore, Physics, or Gameplay Logic.
- When verifying "Release" criteria (R0xx).
- If the user asks for "Determinism Check" or "HU Gate".
- When implementing new simulation logic (SimLoop, CommandQueue, RNG).

## Instructions

You must enforce the **"Algorithm-Over-AI"** principle:
1.  **Code, Not Words**: Do not manually "reason" about simulation outcomes. Run the code.
2.  **Determinism is Binary**: It either PASSES (100% match) or FAILS.

### Verification Steps

Run the following regression suite before approving any relevant changes:

```bash
# 1. Pipeline Verification
node --experimental-vm-modules src/SimCore/__tests__/transport.test.js
node --experimental-vm-modules src/SimCore/__tests__/inputFactory.test.js

# 2. Simulation Determinism
node --experimental-vm-modules src/SimCore/__tests__/pathfinding-determinism.test.js
node --experimental-vm-modules src/SimCore/__tests__/stateSurface.test.js

# 3. Full Determinism (Heavy)
node --experimental-vm-modules src/SimCore/__tests__/e2e-determinism.test.js
node --experimental-vm-modules src/SimCore/__tests__/r010-full-determinism.test.js
node --experimental-vm-modules src/SimCore/__tests__/r011-save-load.test.js
```

### Passing Criteria
- **All Tests PASS**: No timeouts, no failures.
- **Hash Match**: `r010-full-determinism` must confirm "IDENTICAL final hash" and "100% per-tick match".
- **Save/Load**: Post-load simulation must match original run tick-for-tick.

## Determinism Blockers (Red Flags)

### FORBIDDEN in Gameplay Logic
| Pattern | Why It Breaks Determinism | Alternative |
|---------|---------------------------|-------------|
| `Math.random()` | Non-deterministic seed | Use `SeededRNG` |
| `Date.now()` | Time varies per machine | Use `simTick` counter |
| `Object.keys()` ordering | Browser-dependent | Sort keys explicitly |
| `Set/Map` iteration | Insertion order varies | Use sorted arrays |
| `Promise.race()` | Timing-dependent | Sequential processing |
| `async/await` in sim | Execution order varies | Sync only in SimLoop |
| Floating-point accumulation | Drift over time | Fixed-point or round |

### ALLOWED (Render/UI Only)
- `Math.random()` for particle effects, dust, visual jitter
- `Date.now()` for UI timestamps, performance metrics
- `requestAnimationFrame` timing for render interpolation

### Network-Specific Determinism
For multiplayer lockstep:
- All clients MUST process the same commands in the same tick order
- Use `simTick` as the canonical ordering, not wall-clock time
- State hash comparison catches drift early
- Command batches are processed atomically per tick

### Output Format
If successful, output:
> [!IMPORTANT]
> **DETERMINISM GATE: PASS**
> - Pipeline: Verified
> - Hash Match: 100% (SHA confirmed)
> - Save/Load: Verified

If failed, output:
> [!CAUTION]
> **DETERMINISM GATE: FAIL**
> [Detail of mismatch or test failure]
> **ACTION**: Do NOT merge. Fix determinism bug.
