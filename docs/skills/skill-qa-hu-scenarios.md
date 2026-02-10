# SKILL: QA HU Scenarios

**ID**: `skill-qa-hu-scenarios`
**Role**: QA / Human
**Status**: ACTIVE

---

## 1. Purpose
Design and document manual "Hungarian-User" (HU) test scenarios for the Operator (Ádám) to execute, acknowledging that human verification is the final gate.

## 2. Scope
- Pre-merge verification checklists.
- UI/UX "Feel" checks.
- Complex multi-window setups.
- **Language**: Hungarian (Magyar).

## 3. Hard Constraints (MUST NOT)
- **NO Automatable Steps**: If a script can do it easily, don't ask the human. Focus on "does it feel right?".
- **NO Ambiguity**: Steps must be concrete ("Click X", not "Try to join").
- **NO English**: Scenarios for Ádám must be in Hungarian (or dual language).

## 4. Triggers (When to Use)
- UI/UX Refinement.
- Final "Production-Ready" check.
- Multiplayer timing/feel verification.

## 5. Checklist
- [ ] **Pre**: What needs to be open? (e.g. "2 Terminál, tiszta adatbázis").
- [ ] **Step**: Concise action steps.
- [ ] **Expected**: Visible success criteria (PASS/FAIL).

## 6. Usage Examples

### A. Lobby Csatlakozás (Lobby Join)
```text
**HU-TEST REQUEST**:
- **Pre**: 2 böngésző ablak (Host, Guest).
- **Step**: Host klikk "Host Game". Guest klikk "Join" a listában.
- **Expected**: Mindkét képernyőn ugyanaz a pálya jelenik meg 2 másodpercen belül.
**DECISION REQUIRED**: PASS / FAIL?
```

## 7. Out of Scope
- CI Automation.
