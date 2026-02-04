# SKILL: QA Determinism

**ID**: `skill-qa-determinism`
**Role**: QA / Core
**Status**: ACTIVE

---

## 1. Purpose
Verify complete simulation determinism by comparing state hashes across multiple runs or clients given identical inputs.

## 2. Scope
- Dual-run verification scripts.
- State surface hashing.
- Tick-by-tick comparison.
- Stress testing RNG seeds.

## 3. Hard Constraints (MUST NOT)
- **NO Logic Mod**: Must NOT modify the `SimLoop` or `CommandQueue` logic to make tests pass.
- **NO Non-Deterministic Tests**: Tests must NOT use `Date.now()` or `Math.random()` except for setting initial seeds.
- **NO Flakiness**: Tests must be 100% reproducible.

## 4. Triggers (When to Use)
- Verifying "Butterfly Effect" bugs.
- Testing new `Command` types.
- Certifying release candidates (R013, R014).

## 5. Checklist
- [ ] Test runs at least 2 instances.
- [ ] Inputs are injected at specific ticks.
- [ ] Hash comparison checks entire state surface.
- [ ] Seed is explicitly controlled.

## 6. Usage Examples

### A. Dual Run Test
```javascript
const simA = new SimCore(seed: 123);
const simB = new SimCore(seed: 123);
// ... run 100 ticks with identical inputs ...
expect(simA.getHash()).toBe(simB.getHash());
```

## 7. Out of Scope
- Visual/Rendering tests (Use `skill-qa-e2e-playwright`).
