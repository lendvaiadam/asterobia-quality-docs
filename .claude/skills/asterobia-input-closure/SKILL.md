---
name: asterobia-input-closure
description: Enforce InputFactory/Transport closure rules to prevent netcode bypass.
---

# Asterobia Input Closure Skill

## When to use
- When implementing input handling (Input.js, Game.js).
- When creating new Commands (CommandQueue.js).
- When debugging issues where commands "don't sync" or "don't replay".

## The Rule: NO BACKDOORS
**"All gameplay commands must pass through the Transport layer."**

Direct method calls (e.g., `unit.move()`) are **FORBIDDEN** for gameplay actions. They bypass netcode and break determinism.

### Correct Flow
1.  **Input Source** (UI/Keyboard/AI) -> Calls `InputFactory.createCommand(...)`
2.  **InputFactory** -> Sends to `Transport` (Local or Network)
3.  **Transport** -> Pushes to `CommandQueue` (SimCore)
4.  **SimLoop** -> Pops from `CommandQueue` and executes in `simTick()`

### Verification Checklist
When reviewing or writing input code:
- [ ] Are we calling `unit.setPosition()` or similar setters directly? -> **FAIL** (Unless inside SimLoop command handler)
- [ ] Are we using `game.addCommand()` or `InputFactory`? -> **PASS**
- [ ] Does the `Transport` have a chance to intercept? -> **PASS**

### Debugging
If commands are not executing:
1.  Check `Transport` status (Connected?).
2.  Check `CommandQueue` flush in `simTick`.
3.  Ensure `InputFactory` is instantiated and wired to Transport.

## Network Flow (M07+)

### Host (Authority)
```
Local Input → InputFactory → Transport.send()
                                ↓
                         CommandQueue.enqueue()
                                ↓
                         SimLoop.tick() executes
                                ↓
                         SessionManager.broadcast(CMD_BATCH)
```

### Guest (Follower)
```
Local Input → InputFactory → Transport.send()
                                ↓
                         → NetworkTransport → Host (INPUT_CMD)

Host CMD_BATCH arrives via WebSocket
                                ↓
                         CommandQueue.enqueueBatch()
                                ↓
                         SimLoop.tick() executes (same as host)
```

### Key Invariant
**Guests NEVER execute local input directly.**
- Guest sends INPUT_CMD to host
- Host includes it in CMD_BATCH
- Guest receives CMD_BATCH and executes
- This ensures all clients see identical command sequence
