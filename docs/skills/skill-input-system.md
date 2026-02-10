# SKILL: Input System

**ID**: `skill-input-system`
**Role**: Frontend / Interaction
**Status**: ACTIVE

---

## 1. Purpose
Handle user input capture (Keyboard, Mouse, Gamepad), buffering, remapping, and translation into abstract Game Commands via `InputFactory`.

## 2. Scope
- Event listeners (`keydown`, `mousedown`, `gamepadconnected`).
- Input buffering and smoothing.
- Keybinding configuration.
- Raycasting for mouse-to-world interaction.

## 3. Hard Constraints (MUST NOT)
- **NO Direct Mutation**: Must NOT directly mutate `SimCore` state. All inputs must produce **Commands**.
- **NO Network Logic**: Must NOT handle serialization or sending (that is the Transport layer's job).
- **NO HTML UI**: Must NOT create DOM elements (Glossary/Menus); delegate to `skill-ui-vanilla`.

## 4. Triggers (When to Use)
- Implementing new control schemes (WASD, RTS drag-select).
- Adding gamepad support.
- Implementing input recording/replay for testing.

## 5. Checklist
- [ ] Event listeners are attached/detached correctly (no leaks).
- [ ] Input is debounced/buffered if necessary.
- [ ] Raycasting logic handles camera zoom/rotation correctly.
- [ ] Generated commands comply with `InputFactory` schemas.

## 6. Usage Examples

### A. Key Down Handler
```javascript
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    const cmd = InputFactory.createFireCommand(localPlayerId);
    commandQueue.enqueue(cmd); // or transport.send(cmd)
  }
});
```

## 7. Out of Scope
- Visual rendering of cursors (Use `skill-hud-overlay`).
- Network transmission (Use `skill-transport-abstraction`).
