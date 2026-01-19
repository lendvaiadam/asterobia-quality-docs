Status: Archived/Report (NON-CANONICAL unless explicitly referenced)
Origin: recovered from local quality/save
Recovery date: 2026-01-19

# Netcode Preflight Check

This tool scans the codebase for patterns that violate Phase 0 Netcode Readiness.

### How to Run
```bash
node scripts/netcode_preflight.js
```

### What it checks
1.  **`Date.now()`**: Forbidden in logic. Use `Sim.tick` or seeded time.
2.  **`Math.random()`**: Forbidden in logic. Use `Sim.rng` (seeded).
3.  **`requestAnimationFrame`**: Prohibits logic updates in render loop.
4.  **`performance.now()`**: Logic should not depend on real-world clock.

### Interpreting Results
The scanner is naive. It finds text matches.
- **Render/UI Code:** Hits here are usually *OK* (e.g. particle lifetime).
- **SimCore/Unit/Game Logic:** Hits here are **FAILURES** and must be refactored.
