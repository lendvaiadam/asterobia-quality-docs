# SKILL: QA Unit Jest

**ID**: `skill-qa-unit-jest`
**Role**: QA / Unit
**Status**: ACTIVE

---

## 1. Purpose
Implement isolated unit tests for individual modules, classes, and utility functions using Jest/Vitest frameworks.

## 2. Scope
- Unit test files (`*.test.js`).
- Mocking external dependencies.
- Coverage reporting.
- Snapshot testing for data structures.

## 3. Hard Constraints (MUST NOT)
- **NO Integration Chains**: Tests should not rely on the full system stack (use mocks).
- **NO Browser Deps**: Tests should run in Node/Headless environment (no `window`, `document` unless mocked).
- **NO External Side-effects**: Tests must not call real network APIs or write to real DBs.

## 4. Triggers (When to Use)
- Validating new classes/functions (M01 Types, M02 Roles).
- Regression testing specific bug fixes.
- Enforcing API contracts.

## 5. Checklist
- [ ] Test name describes behavior (`it('should calculation X correctly')`).
- [ ] Mocks are reset between tests.
- [ ] Assertions cover success and failure paths.
- [ ] No strict coupling to implementation details (test behavior, not internals).

## 6. Usage Examples

### A. Testing a Serializer
```javascript
import { encode, decode } from './MessageSerializer';
test('round trip', () => {
  const original = { type: 'HELLO' };
  expect(decode(encode(original))).toEqual(original);
});
```

## 7. Out of Scope
- Full game loops (Use `skill-qa-determinism`).
- UI interaction (Use `skill-qa-e2e-playwright`).
