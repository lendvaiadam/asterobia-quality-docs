# GAP ANALYSIS REPORT
**Target:** Master Plan v1 vs Canonical Specs
**Date:** 2026-01-21
**Objective:** Identify implementation details defined in Specs but missing from the Plan.

## 1. Executive Summary
Successful audit of Canonical Specs revealed **20+ specific constraints and formulas** that are binding but were absent from the high-level Master Plan. These must be respected during Phase 1 Implementation.

## 2. Identified Gaps (Verified)

### A. Physics & Locomotion (MOVE_ROLL)
1.  **Slope Bands (Binding):**
    - **0-10°:** Stable behavior.
    - **10-40°:** Speed Penalty `speed *= cos(angle)`.
    - **40-60°:** Critical Zone (Stall or Backslide).
    - **>60°:** Hard Block (Emit `BLOCKED_BY_SLOPE`).
2.  **Water Logic:** Hard block for `MOVE_ROLL`. Must emit `COLLISION_WATER` event (triggers Goal for Swimming).
3.  **Rock Logic:** Hard block. Emit `BLOCKED_BY_ROCK` event.

### B. Transport & Logistics
4.  **Slowdown Formula:** `effectiveSpeed = moveSpeed * lerp(1.0, clamp(TransportScalar,0,1), cargoFill)`.
5.  **Behavior:** Half-full cargo = Half penalty. Empty = No penalty.

### C. Terrain Shaping
6.  **Convergence Model:** Terrain does not update instantly. It "nudges" towards the Target Height every tick (Digging/Building takes time).
7.  **Keyframe Logic:** Target Height is interpolated linearly between path nodes.

### D. Energy & Economy
8.  **Generator Efficiency:** Input Colors Complementary (e.g. Red + Cyan) = **200% Output**. Else 100%.
9.  **Local Battery:** Each Unit has a buffer.
10. **Offline Mode:** If Disconnected AND Battery=0 -> Unit becomes **OFFLINE** (Immobile, Passive only).
11. **Matera Mining:** Continuous output, driven by "Drill" tick.

### E. GRFDTRDPU System
12. **Extend Multiplier:** `1.0 + (Level * 0.5)`. Max Level 5 (3.5x cap).
13. **Training Scope:** Multipliers are **Global per User, Per Feature**. (Not specific to a single unit instance).
14. **Design Minimum:** Minimum feature allocation is **25%**. UI must auto-round up.
15. **Specialization Bonus:**
    - 1 Feature: **+100%**
    - 2 Features: **+50%**
    - 3 Features: **+20%**
    - 4+ Features: **+0%**

### F. Unit Designer & Production
16. **Naming Strictness:** `C-V-C-C-V-C` pattern (e.g. `MORDIG`). Version is `Capacity / 10`.
17. **Upscaling:** Manufacturing Size **1 to 9**. Usage: `[TYPE][VER]-[SIZE]`.
18. **Upscale Math:** Linear multiplier for HP, Cargo, Damage based on Size.
19. **Retrofit:** Facilities can upgrade both **Version** (Design) and **Size** (Scale) of existing units.

### G. Perception
20. **Subsurface Scan:** Is a sub-capability of Perception. Reveals Underground entities.
21. **Radar vs Scan:** "Radar" is a future surface detection feature. Do not confuse with Subsurface Scan.

### H. Multiplayer & Trade
22. **Blueprint License:** Trading Blueprints = Licensing usage rights, NOT transferring data ownership.

---
**Recommendation:**
These rules should be considered **Binding Constraints** for the PRs listed in `APPENDIX_03`.
