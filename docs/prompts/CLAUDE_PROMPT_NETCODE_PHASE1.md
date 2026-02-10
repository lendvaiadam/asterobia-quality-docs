# PROMPT: R013-NB1 Phase 1 (Minimal Viable Loop)

**Role**: Senior Network Engineer (Implementation)
**Context**: "Multiplayer 2.0" - FPS Layer.
**Success Condition**: 2 Browser Clients connect to Local Node.js Server via WebSocket and see each other's "Ghost Unit" (even if static).

---

## 1. The Foundation (Phase 0 Complete)
We have successfully audited and merged **Phase 0 (Scaffolding)**.
*   **Repo State**: `savepoint/r013-nb0-phase0`
*   **Server**: `/server` exists, `SimCore` is pure, `MemoryTransport` tests pass.
*   **Constraint**: Do NOT regress `SimCore` purity. Do NOT add `three.js` to Server.

## 2. The Task (Phase 1 Execution)
Implement the "Real" Transport Layer.

### Step A: WebSocket Server (Node.js)
*   **File**: `server/index.js` (or `server/ServerTransport.js`)
*   **Action**:
    *   Import `WebSocketServer` from `ws`.
    *   Listen on port `3000` (or config).
    *   On connection -> Create `ServerTransport` adapter -> Attach to `GameServer`.
    *   Handle `JOIN_REQ` packets -> Forward to `room.addPlayer()`.

### Step B: WebSocket Client (Browser)
*   **File**: `src/SimCore/transport/WebSocketTransport.js`
*   **Action**:
    *   Implement `ITransport` interface.
    *   `connect()`: Open WS connection to `ws://localhost:3000`.
    *   `send()`: Serialize JSON -> Send string.
    *   `onMessage()`: Parse JSON -> Emit to subscribers.

### Step C: The Switch (Config)
*   **File**: `src/Main.js` (or `SessionManager.js`)
*   **Action**:
    *   Check URL param `?net=ws`.
    *   If present, instantiate `WebSocketTransport` instead of `SupabaseTransport`.
    *   (Keep Supabase as default for now, or fallback).

### Step D: Verification
*   **Goal**:
    1.  Start Server: `cd server && node index.js`
    2.  Start Client A: `http://localhost:8081/game.html?net=ws&user=A`
    3.  Start Client B: `http://localhost:8081/game.html?net=ws&user=B`
    4.  **Success**: Server logs "Client A joined", "Client B joined". Clients receive `SNAPSHOT`.

---

## 3. Implementation Rules
*   **Reuse**: Use the existing `MessageSerializer` logic if possible (don't reinvent packet structure).
*   **Purity**: `WebSocketTransport` allows `WebSocket` (browser native), but keep it out of `SimCore/domain` logic if possible (keep it in `SimCore/transport`).
*   **Error Handling**: If WS connection fails, log error to UI (don't crash).

**Go!**
