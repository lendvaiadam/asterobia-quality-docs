---
name: determinism-scan
description: Run determinism blocker audit (Gate 01 patterns)
allowed-tools: Grep, Read
---

# Determinism Scan

Audit `src/` for determinism blockers. Report only, do NOT modify files.

## Grep Patterns

Run these searches against `src/`, excluding `*_old.js` and `*_restore_*.js`:

### E1: Variable Timestep
```
Grep pattern="getDelta|deltaTime|clock\.delta" path="src/"
Grep pattern="requestAnimationFrame" path="src/"
```

### E2: Unseeded Randomness
```
Grep pattern="Math\.random" path="src/"
```

### E3: Non-Deterministic Timestamps
```
Grep pattern="Date\.now|performance\.now" path="src/"
```

## Output Format

For each hit, output a row:

| File | Line | Snippet | Class |
|------|------|---------|-------|
| `src/Core/Game.js` | 2709 | `clock.getDelta()` | BLOCKER |

**Classification:**
- **BLOCKER** = affects sim state (position, commands, IDs, logic)
- **SAFE** = render-only, UI, metrics, audio, camera, particles

## Summary Table

At end, output totals:

| Category | BLOCKER | SAFE |
|----------|---------|------|
| E1 Timestep | ? | ? |
| E2 Random | ? | ? |
| E3 Timestamps | ? | ? |
| **TOTAL** | ? | ? |

## Constraints

- Use only Grep and Read tools
- Exclude: `*_old.js`, `*_restore_*.js`
- Do NOT edit or create files
