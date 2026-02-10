# SKILL: Transport Abstraction

**ID**: `skill-transport-abstraction`
**Role**: Backend / Network Architecture
**Status**: ACTIVE

---

## 1. Purpose
Ensure strict compliance with the `ITransport` interface and the `InputFactory` pattern, guaranteeing that the Simulation Core remains decoupled from the network implementation.

## 2. Scope
- `ITransport` implementation and auditing.
- `InputFactory` usage verification.
- Ensuring `SimCore` remains network-agnostic.

## 3. Hard Constraints (MUST NOT)
- **NO Bypass**: Must NOT bypass `InputFactory` -> `Transport` -> `CommandQueue` flow for logical inputs.
- **NO Raw Networking**: Must NOT use raw `WebSocket`, `socket.io`, or `fetch` calls inside `SimCore` logic.
- **NO Logic Coupling**: Must NOT import transport-specific modules (like `SupabaseTransport`) into the core simulation domains (like `SimLoop`).

## 4. Triggers (When to Use)
- Adding new network message types.
- Implementing alternative transports (e.g., LocalShim, MockTransport, WebRTC).
- Routine architectural audits.

## 5. Checklist
- [ ] Is `SimCore` free of `import { * } from 'supabase'`?
- [ ] Are all inputs created via `InputFactory`?
- [ ] Does the new transport implement `connect`, `send`, `disconnect`?
- [ ] Are network events handled generically (e.g., `onMessage` callbacks)?

## 6. Usage Examples

### A. Sending a Command
```javascript
// Correct
const cmd = InputFactory.createMoveCommand(unitId, x, y);
transport.send(cmd);

// Incorrect
socket.emit('move', { unitId, x, y });
```

### B. Receiving a Command
```javascript
transport.onReceive((msg) => {
  if (msg.type === 'INPUT') {
    commandQueue.enqueue(msg.payload);
  }
});
```

## 7. Out of Scope
- Database queries (Use `skill-supabase-realtime` or `skill-supabase-schema`).
