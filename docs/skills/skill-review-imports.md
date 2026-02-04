# SKILL: Review Imports

**ID**: `skill-review-imports`
**Role**: Refactor / Architecture
**Status**: ACTIVE

---

## 1. Purpose
Audit and optimize module import/export structures, detecting circular dependencies and ensuring clean architectural layering.

## 2. Scope
- Circular dependency detection (`madge`).
- Barrel file management (`index.js`).
- Path consistency (Absolute vs Relative).

## 3. Hard Constraints (MUST NOT)
- **NO Public API Break**: Do not change named exports to defaults or vice versa without broad refactor.
- **NO New Deps**: Do not introduce new npm packages.
- **NO Auto-Fix Circles**: Circular dependencies require Architectural escalation, not blind fixes.

## 4. Triggers (When to Use)
- Build errors relating to modules.
- "Undefined is not a function" runtime errors (often circular dep symptoms).
- Repo organization passes.

## 5. Checklist
- [ ] No cycles detected (`npx madge --circular src/`).
- [ ] Imports flow "down" (UI imports Core, Core does not import UI).
- [ ] Consistent pathing (e.g. prefer relative for siblings).

## 6. Usage Examples

### A. Consolidating Exports
```javascript
// src/Core/index.js
export * from './Game.js';
export * from './InputFactory.js';
```

## 7. Out of Scope
- Logic rewrites.
