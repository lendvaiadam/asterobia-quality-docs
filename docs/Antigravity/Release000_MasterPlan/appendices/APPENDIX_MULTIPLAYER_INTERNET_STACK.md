# APPENDIX A: MULTIPLAYER & INTERNET STACK (v3)

**Parent Document:** [Big Picture Master Plan v3](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** Deep technical specification of the SimCore Kernel, the Loop, and the Transport Layer.

---

## 1. The SimCore Kernel (`SimCore.js`)

The `SimCore` is the **Authoritative Game State Container**. It must run deterministically on any machine (Host or Client).

### 1.1 The Fixed Timestep Loop (Accumulator)

We rely on a "Fix Your Timestep" approach to guarantee that `update()` always sees a `dt` of exactly 50ms (20Hz).

```javascript
// src/core/SimLoop.js (Conceptual)

export class SimLoop {
    constructor(simCore, renderCallback) {
        this.sim = simCore;
        this.render = renderCallback;
        
        this.accumulator = 0;
        this.lastTime = performance.now();
        this.running = false;
        
        // CONSTANTS
        this.TIMESTEP = 50; // 50ms = 20Hz
        this.MAX_FRAME_TIME = 250; // Prevent spiral of death
    }

    start() {
        this.running = true;
        this.lastTime = performance.now();
        requestAnimationFrame(this.tick.bind(this));
    }

    tick(currentTime) {
        if (!this.running) return;

        let delta = currentTime - this.lastTime;
        this.lastTime = currentTime;

        // Cap delta to prevent spiral of death on lag spikes
        if (delta > this.MAX_FRAME_TIME) delta = this.MAX_FRAME_TIME;

        this.accumulator += delta;

        // Consumer: Eat 50ms chunks
        while (this.accumulator >= this.TIMESTEP) {
            // 1. Process Network Inputs
            this.sim.processInputs();
            
            // 2. Advance Simulation
            this.sim.step(this.TIMESTEP);
            
            this.accumulator -= this.TIMESTEP;
        }

        // 3. Render with Interpolation Alpha
        // alpha = 0.5 means "halfway between previous and current state"
        const alpha = this.accumulator / this.TIMESTEP;
        this.render(alpha);

        requestAnimationFrame(this.tick.bind(this));
    }
}
```

### 1.2 State Registry Structure (`StateRegistry.js`)

State is separated into **Authority** (Networked) and **Render** (Local).

```typescript
// The "Authority" State - Serialized & Sent over network
interface IGameState {
    meta: {
        tick: number;
        seed: number;       // For RNG
        nextEntityId: number;
    };
    
    // Players (Economy, Tech)
    players: Record<string, {
        id: string;
        resources: { matera: number; energy: number };
        techTree: Record<string, number>; // "MOVE_ROLL": 1
    }>;

    // Entities (Units, Buildings)
    entities: Record<string, {
        id: number;
        type: string;       // "UNIT_DRILLBUG"
        owner: string;
        pos: { x: number, z: number }; // 2D Logic Plane (Physics is 2D+HeightMap)
        rot: number;        // Yaw only
        hp: number;
        state: string;      // "IDLE", "MOVING", "MINING"
        
        // Component Data (Sparse)
        cargo?:  { amount: number; type: string };
        mine?:   { targetNodeId: number };
        move?:   { target: {x,z}; velocity: {x,z} };
    }>;

    // World (Deposits, Terrain Mods)
    world: {
        deposits: Record<string, { val: number }>;
        terrainMods: Array<{ x: number, z: number, h: number }>;
    };
}
```

---

## 2. Command Pipeline (Input Handling)

Inputs are **NOT** executed immediately. They are turned into `Commands`, sent to the Host, queued, and executed in the `processInputs()` phase of the SimLoop.

### 2.1 Command Types

```typescript
type CommandType = 
    | 'CMD_MOVE' 
    | 'CMD_STOP' 
    | 'CMD_BUILD' 
    | 'CMD_DESIGN' 
    | 'CMD_ATTACK';

interface ICommand {
    type: CommandType;
    tick: number;        // The tick this command SHOULD execute on
    sender: string;      // Player ID
    ids: number[];       // Unit IDs selected
    payload: any;        // { x: 100, z: 50 }
}
```

### 2.2 The Command Factory (Client Side)

```javascript
// src/input/CommandFactory.js
export class CommandFactory {
    static createMoveCommand(player, unitIds, vector3Target) {
        return {
            type: 'CMD_MOVE',
            tick: ClientClock.getEstimatedServerTick() + 2, // Buffer 2 ticks
            sender: player.id,
            ids: unitIds,
            payload: {
                x: Math.round(vector3Target.x),
                z: Math.round(vector3Target.z)
            }
        };
    }
}
```

### 2.3 Command Processing (Server/Sim Side)

```javascript
// src/core/SimCore.js
processInputs() {
    // 1. Sort queue by tick (though we mostly process 'current' tick)
    const cmdsToRun = this.commandQueue.getCommandsForTick(this.state.meta.tick);

    for (const cmd of cmdsToRun) {
        if (!this.validateCommand(cmd)) continue; // Anti-Cheat / Logic Check

        switch(cmd.type) {
            case 'CMD_MOVE': 
                this.systems.locomotion.applyMove(cmd); 
                break;
            case 'CMD_ATTACK':
                this.systems.combat.applyAttack(cmd);
                break;
        }
    }
}
```

---

## 3. The Transport Layer (`ITransport`)

We use an **Interface Pattern** to support Phase 0 (Local), Phase 1 (LAN), and Phase 2 (P2P).

### 3.1 Interface Definition

```typescript
interface ITransport {
    // Lifecycle
    host(lobbyConfig: any): Promise<string>; // Returns PeerID
    join(hostPeerId: string): Promise<void>;
    
    // I/O
    sendCmd(cmd: ICommand): void;
    sendSnapshot(state: IGameState): void;
    
    // Hooks
    onCmdReceived(cb: (cmd: ICommand) => void): void;
    onSnapshotReceived(cb: (state: IGameState) => void): void;
    onLatencyUpdate(cb: (ms: number) => void): void;
}
```

### 3.2 Phase 0: `LocalLoopback` (In-Memory)

```javascript
// src/net/LocalTransport.js
export class LocalTransport {
    constructor() {
        this.delay = 0; // Simulate lag (ms)
        this.hostCallback = null;
        this.clientCallback = null;
    }

    sendCmd(cmd) {
        // "Network" is just a setTimeout
        setTimeout(() => {
            if (this.hostCallback) this.hostCallback(cmd);
        }, this.delay);
    }
    
    sendSnapshot(state) {
        // Must CLONE state to prevent reference sharing cheats
        const serialized = JSON.stringify(state);
        setTimeout(() => {
            if (this.clientCallback) this.clientCallback(JSON.parse(serialized));
        }, this.delay);
    }
}
```

### 3.3 Phase 2: `WebRTCTransport` (PeerJS)

We use **PeerJS** to abstract the ICE/STUN complexity.

**Host Logic:**
1.  Open PeerJS connection.
2.  Get ID (`uuid-v4`).
3.  Upload ID to Supabase `Lobbies` table.
4.  Listen for `connection`.
    *   On Data: `handleRemoteCommand(data)`.

**Client Logic:**
1.  Read `hostPeerId` from Supabase.
2.  `peer.connect(hostPeerId)`.
3.  Listen for `data`.
    *   On Data: `applyServerSnapshot(data)`.

---

## 4. Determinism & Randomness

Determinism is **Critical**. If `Math.random()` is called once, the clients desync.

### 4.1 The Seeded RNG (`Mulberry32`)

We NEVER use `Math.random`. We use a custom PRNG seeded by the Host.

```javascript
// src/core/RNG.js
export function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// In SimCore
init(seed) {
    this.random = mulberry32(seed);
}

// Usage
spawnParticles() {
    const x = this.random() * 100; // Deterministic!
}
```

### 4.2 Desync Detection

Every 100 ticks, Host sends a **Hash** of the State.
Clients compare their Local State Hash.
*   **Match:** Good.
*   **Mismatch:** `CRITICAL_DESYNC`. Client requests full Snapshot re-download.

---
*End of Appendix*
