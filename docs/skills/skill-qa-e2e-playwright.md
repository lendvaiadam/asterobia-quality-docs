# SKILL: QA E2E Playwright

**ID**: `skill-qa-e2e-playwright`
**Role**: QA / Integration
**Status**: ACTIVE

---

## 1. Purpose
Execute end-to-end browser automation tests to verify full-stack flows, UI interactions, and multiplayer scenarios.

## 2. Scope
- Browser automation (Headless/Headed).
- UI component state verification.
- Multiplayer connection flows (Host + Guest).
- Visual regression (Screenshots).

## 3. Hard Constraints (MUST NOT)
- **NO Sim Logic Test**: Do NOT use Playwright to verify deep math logic (too slow/flaky).
- **NO Bypass**: Test MUST use the real UI constraints (click buttons, don't just call JS functions).
- **NO Fragile Selectors**: Use data-ids (`data-testid="join-btn"`) instead of fragile CSS/XPath.

## 4. Triggers (When to Use)
- Verifying Lobby Join flow (M07).
- Checking HUD rendering.
- Smoke tests for "Can the game load?".

## 5. Checklist
- [ ] Tests use `test-id` selectors.
- [ ] Tests handle asynchronous loading (wait for element).
- [ ] Tests clean up state (close browser context).
- [ ] Multiplayer tests execute independent contexts.

## 6. Usage Examples

### A. Lobby Join Flow
```javascript
test('guest can join host', async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  // ... host creates, guest joins ...
  await expect(guest.locator('#status')).toHaveText('Connected');
});
```

## 7. Out of Scope
- Unit level logic (Use `skill-qa-unit-jest`).
