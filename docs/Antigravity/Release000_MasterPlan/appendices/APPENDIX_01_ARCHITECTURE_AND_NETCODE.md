# APPENDIX 01: ARCHITECTURE & NETCODE STACK

**Parent Document:** [Big Picture Master Plan](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** SimCore Internals, Protocol, Backend Schema, Determinism.

---

## 1. SimCore Kernel Architecture

The `SimCore` is a standalone JS/TS module that contains **100% of the gameplay logic**. It must be runnable in a headless Node.js environment (for future validation) or in a Web Worker (for performance).

### 1.1 The "Update" Loop
The core loop is an **Accumulator Pattern** loop.
```javascript
// Conceptual Implementation
let accumulator = 0;
const TIMESTEP = 50; // 50ms = 20Hz

function onFrame(delta) {
  accumulator += delta;
  while (accumulator >= TIMESTEP) {
    SimCore.step(); // Strictly advances state by 50ms
    accumulator -= TIMESTEP;
  }
  // View renders state + accumulator/TIMESTEP (alpha) for interpolation
}
```

### 1.2 State Tree (The "Database")
The state is a single JSON-serializable tree.
```json
{
  "tick": 1205,
  "seed": 9938472,
  "nextId": 505,
  "entities": {
    "u_101": { "type": "UNIT", "pos": [10, 0, 50], "hp": 100, "q": [...] },
    "m_202": { "type": "MATERA_PILE", "val": 500 }
  },
  "terrain": { "mods": [...] },
  "players": { "p_1": { "resources": 1000 } }
}
```

---

## 2. Networking & Transport Layer

### 2.1 Interface Abstraction (ITransport)
We abstract the network so we can swap "Local Loopback" for "WebRTC" without breaking logic.
```javascript
interface ITransport {
  connect(hostId: string): Promise<void>;
  send(cmd: Command): void;
  onReceive(handler: (cmd: Command) => void): void;
}
```

### 2.2 Phase 0: Local Loopback
- Uses `BroadcastChannel` or direct memory reference.
- Allows running 2 tabs (Host + Client) on the same PC.
- Zero latency, perfect for testing Authority logic.

### 2.3 Phase 1: WebRTC (PeerJS)
- **Signaling:** Clients connect to Supabase to find Host's PeerID.
- **Data Channels:** `reliable: true` for Commands, `reliable: false` for Snapshots (optional optimization).
- **Architecture:** Star Topology.
    - Host is central. All Clients connect to Host.
    - Host relays valid actions to other Clients.

---

## 3. Backend (Supabase)

We use Supabase for persistent data and matchmaking support.

### 3.1 Auth
- Users sign in (Email/Discord/Anon).
- `auth.users` table manages identity.

### 3.2 Database Schema (MVP)

**Table: `lobbies`**
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | uuid | Unique Room ID |
| `host_id` | uuid | Current Host User |
| `host_peer_id` | text | PeerJS ID to connect to |
| `status` | text | OPEN, PLAYING, CLOSED |
| `players` | json | List of connected players |

**Table: `blueprints`**
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | uuid | |
| `owner_id` | uuid | Creator |
| `name` | text | "MORDIG10" |
| `data` | jsonb | Full spec (Features, Axes) |
| `is_public` | bool | Market availability |

### 3.3 Signaling (Realtime)
- Clients subscribe to `lobbies` changes.
- When Host updates `status`, Clients see it.
- When a Player joins, they write to `lobbies.players` (via RPC to ensure atomic entry).

---

## 4. Determinism Strategy

### 4.1 Random Number Generation (RNG)
- **Forbidden:** `Math.random()`
- **Required:** `Mulberry32` or `PCG` algorithm.
- **Implementation:**
    - `SimCore` holds the current `seed`.
    - Every tick, if logic needs random, it calls `this.rng()`.
    - This updates the seed in the State.
    - **Result:** Replaying inputs from Tick 0 results in the exact same sequence of random events.

### 4.2 Entity IDs
- **Forbidden:** `Date.now()`, `uuid.v4()` (unless seeded)
- **Required:** Incremental Integers or Deterministic Hashes.
- **Implementation:** `state.nextId` increments on every spawn.
    - Host spawns Unit: ID = 100.
    - Client (predicting) spawns Unit: ID = 100. (Syncs perfectly).

### 4.3 Float Precision
- JavaScript numbers are IEEE 754 doubles. Standard across browsers *mostly*.
- **Risk:** `Math.sin/cos` may vary slightly on different CPU/Browsers.
- **Mitigation:**
    - Avoid complex transcendental streams in critical divergence paths.
    - Or use a discrete math library (fixed-point) if desyncs occur.
    - *Decision:* Stick to native Floats for Phase 0. Add fixed-point later if desync is proven.

---

## 5. Security & Anti-Cheat (Phase 2)

### 5.1 Host Trust
In Host-Authoritative, the Host *can* cheat.
- **Mitigation:** "Gentleman's Agreement" for Phase 1.
- **Future:** Relay Server that validates inputs (Authoritative Server).

### 5.2 Input Validation
The Host validates all commands:
- "Can player P move Unit U?" (Ownership check).
- "Is Unit U dead?" (State check).
- "Is cooldown ready?" (Logic check).
Invalid commands are rejected and dropped; they never execute in the Sim.

---
*End of Appendix 01*
