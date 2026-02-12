# Netcode Architecture Specification: FPS/Combat Layer
**Version:** 1.1 (Phase 2A Implemented)
**Status:** Phase 0-1 MERGED, Phase 2A IN PROGRESS
**Reference:** `docs/prompts/CHATGPT_PROMPT_R013_SLICE2_START.md`

---

## 1. Executive Summary & Critical Stance
This document outlines the architecture for the new high-frequency (FPS) netcode layer, distinct from the RTS lockstep simulation.
**Critical Goal:** To support fast-paced combat (projectile physics, instant movement) where 200ms latency is unacceptable.

### 🛑 Self-Critique & Risks
We are moving from a "Simple Peer-to-Peer" model to a "Complex Client-Server" model.
*   **Risk 1 (Complexity Explosion)**: Managing a dedicated node.js server adds deployment, scaling, and monitoring overhead we didn't have before.
*   **Risk 2 (Code Sharing)**: Sharing physics code between Browser (Client) and Node (Server) is historically fragile (bundler wars, `window` vs `global`).
*   **Risk 3 (Split Brain)**: Having two netcode paths (RTS Lockstep vs FPS Server) in one game is a recipe for bugs. **Mitigation:** The FPS Server *must* eventually own the RTS logic too, or the RTS logic must be a subset of the Server logic.

---

## 2. Repo Structure: The "Separation of Concerns" (Pragmatic Approach)

**Decision:** Root `/server` + Root `/src` (No rename).
**Reasoning (Critical):** Renaming `/src` to `/src/Client` during an active feature sprint (R013) introduces massive merge conflicts and breaks build configs for negligible gain. We prioritize stability.

```text
/
  /src            (Client Entry + Shared Logic)
    /SimCore      (Isomorphic: Physics, Math) -> SHARED CORE
    /Main.js      (Client Boot)
  /server         (Node.js: WebSocket, Auth) -> Imports ../src/SimCore
  /tools          (Shared Scripts)
```

### 🛑 Critical Analysis
*   **The Trap**: "Perfect Architecture" = `/client` & `/server`.
    *   *Problem*: Migrating an existing `vite/webpack` setup mid-flight is dangerous.
    *   *Solution*: Accept that `/src` contains the Client App. The Server is an "addon" that borrows logic from `/src/SimCore`.
    *   *Constraint*: The Server must treat `/src/SimCore` as a read-only dependency. It must NOT import anything else from `/src` (e.g., UI components).

---

## 3. Control Plane: Supabase vs GameServer

**Decision:** Hybrid Model (Supabase = Auth/Lobby, GameServer = Match).

### 🛑 Critical Analysis: The "Hop" Problem
*   **The Happy Path**: Client -> Supabase (Get Server IP) -> Connect WS.
*   **The Failure Mode**: Supabase is down/slow -> Game is unreachable.
*   **The Latency**: Getting the server IP takes ~500ms (HTTP).
*   **Critique**: Why not connect directly?
    *   *Valid reason*: We need to scale. We can't have a static IP hardcoded.
*   **Refinement with Critical Thinking**:
    *   **Dev Mode**: MUST support `direct_connect: true` to `localhost:3000` bypassing Supabase entirely for rapid iteration.
    *   **Cache**: Client should cache the last known good server IP? No, servers are ephemeral.
    *   **Conclusion**: The "Hop" is necessary for scaling, but the Code must support a "Bypass" for reliability/dev.

---

### 3.1 Runtime & Dependencies: The "Boring Technology" Stack

**Decision:** **Node.js (LTS)** + `ws` (library).
**Reasoning (Critical):**
*   **Stability**: Node.js on Windows/Linux is battle-tested. Bun is great but introduces "unknown unknowns" (subtle API differences, Windows quirks).
*   **Compatibility**: Our build tools (Vite/Vitest) are optimized for Node.
*   **Upgrade Path**: If Node performance becomes a bottleneck (unlikely for <500 CCU), switching to Bun/uWebSockets.js is a "drop-in" replacement later. We start safe.
*   **Language**: **JavaScript (ES Modules)**. No TypeScript compilation step for the Server (keeps dev loop instant). JSDoc for types.

---

## 4. Testing Strategy: In-Memory Integration

**Decision:** `tests/integration/netcode/` using **In-Memory Sockets**.

### 🛑 Critical Analysis: The "E2E is Flaky" Reality
*   **The Naive Plan**: Spawn `node server.js`, spawn 2 headless chrome instances.
*   **The Reality**:
    *   Slow (5s startup).
    *   Flaky (Socket hangup, Race conditions).
    *   Hard to debug (logs are scattered).
*   **The Better Way (In-Memory)**:
    *   Instantiate `Server` class in the requested Test Runner.
    *   Instantiate 2 `Client` classes in the *same process*.
    *   Mock the WebSocket with a `DirectPassThrough` pipe.
    *   *Result*: Tests run in milliseconds, full determinism, stack traces work across client/server boundary.
    *   *Concession*: We still need 1-2 "Real" E2E tests to verify the actual WebSocket library constraints.

---

## 5. Network Physics: The Hardest Part (Skill Requirement)

**Decision:** Build a `docs/skills/NETCODE_FPS.md`.

### 🛑 Critical Analysis
*   **The Trap**: Developers think "UDP is faster" and try to use WebRTC data channels immediately.
    *   *Why it fails*: WebRTC handshake is slow/complex. TCP (WebSocket) is fine for distinct server regions if logic is good.
*   **The Real Problem**: **Buffer Bloat & Jitter**.
    *   *Critique*: Sending updates every frame (60Hz) kills bandwidth.
    *   *Refinement*: Send at 20Hz, Interpolate at 60Hz. Input prediction is mandatory.
    *   *Constraint*: The skill/doc must explicitly forbid "naive position syncing". It must mandate **Command Inputs (Move Vector)** + **Snapshot Correction**.

---

## ---

## 6. Implementation Roadmap (Phased)

### Phase 0: Scaffolding & Purity (CRITICAL FIRST STEP)
**Goal:** A running "Headless Server" that imports `SimCore` without crashing.
1.  **SimCore Audit**: Grep for `three.js` / `window` / `document` in `src/SimCore`. Move rendering logic OUT to `src/Client`.
2.  **Server Scaffold**: `npm init` in `/server`. Configure `package.json` to treat `type: module`.
3.  **Test Harness**: Create `tests/integration/netcode/setup.js` that loads `Server` and `Client` in the same process.

### Phase 1: Minimal Viable Loop (MERGED)
**Goal:** 2 Clients connecting and seeing each other.
1.  **WebSocket Server**: Simple `ws` server in `server/index.js`.
2.  **ITransport**: Implement `WebSocketTransport` in Client (mirroring `SupabaseTransport`).
3.  **Match Loop**: Server accepts `JOIN`, sends `SNAPSHOT` (empty), accepts `INPUT`.

### Phase 2A: Server Authority — "Manifest-Lite" (IN PROGRESS)
**Goal:** Server is the single source of truth for all entity state. Clients are input senders + render mirrors.

**Authority Model:**
*   **Server** runs Room with HeadlessUnits at 20Hz. Owns CommandQueue. All sim-state mutations inside `Room._onSimTick()`. Broadcasts compact `SERVER_SNAPSHOT` every tick.
*   **Clients** (Host AND Guest equally) capture WASD input, send `MOVE_INPUT` commands. Do NOT run `Unit.update()` for authoritative entities. Buffer incoming snapshots, render smooth 60fps via `SnapshotBuffer` interpolation.

**Lifecycle:**
```
HOST_ANNOUNCE → Room created (WAITING)
    → SPAWN_MANIFEST (host sends client entity IDs) → Room.createUnitsFromManifest() → Room.start() (RUNNING)
    → SERVER_SNAPSHOT broadcast every tick (20Hz)
    → Guest JOIN_ACK observed → server creates guest HeadlessUnit
    → MOVE_INPUT routed by transport-authenticated slot → CommandQueue → _onSimTick
```

**Key Design Decisions:**
1.  **Manifest-Lite**: Host sends `SPAWN_MANIFEST` with client-provided entity IDs. Server mirrors them 1:1. No server-side entity ID generation for manifest units. Guarantees ID mapping by construction.
2.  **Transport-Authenticated Identity**: `GameServer._clientSlots: Map<clientId, {roomId, slot}>` populated from server-assigned `client.id` (relay's internal ID). **NEVER** trusts `payload.sourceSlot`.
3.  **MOVE_INPUT.unitId**: Optional field for multi-unit control. Server routes by `unitId` if present, falls back to `ownerSlot`. Authority check: sender must own the unit.
4.  **Spawn Suppression**: Client's `_spawnUnitForPlayer()` returns null when `_mirrorMode === true`. Prevents double-spawn in server-authoritative mode.
5.  **Snapshot Reconciliation**: ID-based mapping (not ownerSlot — N:1 relationship). Creates visual shells for server units missing locally. Stale local units tolerated (not deleted).

**Env Gating:** `PHASE2A=1 node server/index.js` enables `GameServer.wireToRelay()`. Without this, server runs Phase 1 relay-only.

**Latency:** ~150-200ms input-to-visual (RTT + interpolation buffer). Intentionally "heavy/tank-like." Client-side prediction is Phase 2B scope.

**Files:**
| File | Role |
|------|------|
| `server/GameServer.js` | wireToRelay, message routing, _clientSlots |
| `server/Room.js` | WAITING→RUNNING lifecycle, createUnitsFromManifest, _onSimTick |
| `server/HeadlessUnit.js` | Spherical movement, applyInput, GROUNDED/AIRBORNE |
| `src/SimCore/net/SnapshotBuffer.js` | Ring buffer, smooth clock EMA, teleport threshold |
| `src/Core/Game.js` | Mirror mode, _sendSpawnManifest, snapshot reconciliation |
| `src/SimCore/multiplayer/SessionManager.js` | sendMoveInput(keys, unitId), SNAPSHOT wiring |

**Testing:** `tests/integration/netcode/phase2a-lifecycle.test.js` — Full GameServer.wireToRelay pipeline via mock relay. No real WebSockets.

**HU Test:** `LAUNCH_HU_TEST_PHASE2A.bat` — 2 tabs with `PHASE2A=1`.

**Local Run Commands:**
```bash
# Single combined server: static files + WS relay on ONE port (8081).
node server/index.js                              # Phase 1, port 8081
set PHASE2A=1 && node server/index.js             # Phase 2A, port 8081
set PORT=9000 && node server/index.js             # Custom port
npm run start:server                              # Shortcut for above

# Open: http://localhost:8081/game.html?net=ws&dev=1

# Windows launcher BATs (start server + 2 browser tabs):
LAUNCH_WS_TEST.bat                                # Phase 1
LAUNCH_HU_TEST_PHASE2A.bat                        # Phase 2A
# Override port: set PORT=9000 && LAUNCH_HU_TEST_PHASE2A.bat
```

**Port:** Default `8081` (HTTP + WS on same port). Override with `PORT` env var.

**Client WS URL:** Auto-detects from `window.location.port`. Override: `?wsPort=9000` or `?wsUrl=ws://host:port`.

---

