# APPENDIX C: REPLAY SYSTEM SPEC

**Parent Document:** [MASTER_PLAN_FINAL_v2.md](../MASTER_PLAN_FINAL_v2.md)
**Decision:** Per Human Owner Q1 - Include basic command-log replay
**Scope:** Recording, storage, playback, verification

---

## 1. Purpose

| Use Case | Description |
|----------|-------------|
| Debug | Reproduce bugs by replaying exact inputs |
| Anti-cheat | Verify game outcomes server-side |
| Analysis | Review gameplay decisions |
| Spectate | Watch recorded games (future) |

---

## 2. Command Log Format

### 2.1 Schema

```javascript
const commandLogSchema = {
  version: "1.0",
  metadata: {
    gameId: "game_abc123",
    seed: 42,
    startedAt: "2026-01-24T12:00:00Z",
    endedAt: "2026-01-24T12:30:00Z",
    tickCount: 36000,
    players: [
      { id: "p1", displayName: "Player1" },
      { id: "p2", displayName: "Player2" }
    ]
  },
  initialState: {
    // Full SimCore state at tick 0
    tick: 0,
    entities: { /* ... */ },
    terrain: { /* ... */ },
    players: { /* ... */ }
  },
  commands: [
    {
      tick: 10,
      seq: 1,
      type: "MOVE",
      playerId: "p1",
      unitIds: ["u_1"],
      payload: { targetPosition: [100, 0, 50] }
    },
    {
      tick: 25,
      seq: 2,
      type: "ATTACK",
      playerId: "p1",
      unitIds: ["u_1"],
      payload: { targetId: "e_1" }
    }
    // ... all commands
  ],
  finalStateHash: "sha256:abc123..."
};
```

### 2.2 Command Types

| Type | Payload |
|------|---------|
| MOVE | `{ targetPosition: [x,y,z] }` |
| STOP | `{}` |
| ATTACK | `{ targetId: string }` |
| MINE | `{ depositId: string }` |
| TRANSPORT | `{ targetId: string, action: 'PICKUP' | 'DROPOFF' }` |
| RESEARCH | `{ goalId: string }` |
| DESIGN | `{ blueprint: object }` |
| PRODUCE | `{ typeId: string }` |
| TOGGLE_SCAN | `{ enabled: boolean }` |

---

## 3. Recording

### 3.1 CommandLog Class

```javascript
// src/SimCore/replay/CommandLog.js
export class CommandLog {
  constructor(simCore) {
    this.simCore = simCore;
    this.commands = [];
    this.initialState = null;
    this.metadata = null;
    this.recording = false;
  }

  startRecording(metadata) {
    this.recording = true;
    this.metadata = {
      ...metadata,
      seed: this.simCore.rng.seed,
      startedAt: new Date().toISOString()
    };
    this.initialState = this.simCore.serialize();
    this.commands = [];
  }

  logCommand(command) {
    if (!this.recording) return;

    this.commands.push({
      tick: command.tick,
      seq: this.commands.length,
      type: command.type,
      playerId: command.playerId,
      unitIds: command.unitIds,
      payload: command.payload
    });
  }

  stopRecording() {
    this.recording = false;
    this.metadata.endedAt = new Date().toISOString();
    this.metadata.tickCount = this.simCore.tick;
  }

  export() {
    return {
      version: "1.0",
      metadata: this.metadata,
      initialState: this.initialState,
      commands: this.commands,
      finalStateHash: this.simCore.getStateHash()
    };
  }

  getCommandsSince(tick) {
    return this.commands.filter(c => c.tick > tick);
  }
}
```

### 3.2 Integration with SimCore

```javascript
// In CommandProcessor
processCommand(command) {
  // Log before processing
  this.simCore.commandLog.logCommand(command);

  // Process as normal
  const handler = this.handlers.get(command.type);
  if (handler) {
    handler(command);
  }
}
```

---

## 4. Playback

### 4.1 ReplayPlayer Class

```javascript
// src/SimCore/replay/ReplayPlayer.js
export class ReplayPlayer {
  constructor() {
    this.simCore = null;
    this.commandLog = null;
    this.commandIndex = 0;
    this.playing = false;
    this.speed = 1.0; // Playback speed multiplier
  }

  load(commandLog) {
    this.commandLog = commandLog;
    this.commandIndex = 0;

    // Create fresh SimCore with same seed
    this.simCore = new SimCore({
      seed: commandLog.metadata.seed,
      isReplay: true
    });

    // Load initial state
    this.simCore.loadState(commandLog.initialState);
  }

  play() {
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  step() {
    if (!this.playing) return;

    // Inject commands for this tick
    while (
      this.commandIndex < this.commandLog.commands.length &&
      this.commandLog.commands[this.commandIndex].tick <= this.simCore.tick
    ) {
      const cmd = this.commandLog.commands[this.commandIndex];
      this.simCore.commandQueue.enqueue(cmd);
      this.commandIndex++;
    }

    // Step simulation
    this.simCore.step();
  }

  seekToTick(targetTick) {
    // Reset to initial state
    this.simCore.loadState(this.commandLog.initialState);
    this.commandIndex = 0;

    // Fast-forward
    while (this.simCore.tick < targetTick) {
      this.step();
    }
  }

  getProgress() {
    return {
      currentTick: this.simCore.tick,
      totalTicks: this.commandLog.metadata.tickCount,
      percent: this.simCore.tick / this.commandLog.metadata.tickCount
    };
  }

  verify() {
    // Run to end and check hash
    while (this.simCore.tick < this.commandLog.metadata.tickCount) {
      this.step();
    }

    const actualHash = this.simCore.getStateHash();
    const expectedHash = this.commandLog.finalStateHash;

    return {
      valid: actualHash === expectedHash,
      actualHash,
      expectedHash
    };
  }
}
```

---

## 5. Storage

### 5.1 Compression

```javascript
import pako from 'pako';

function compressCommandLog(log) {
  const json = JSON.stringify(log);
  const compressed = pako.deflate(json);
  return compressed;
}

function decompressCommandLog(compressed) {
  const json = pako.inflate(compressed, { to: 'string' });
  return JSON.parse(json);
}
```

### 5.2 Persistence

```javascript
// Save to Supabase Storage
async function saveReplay(userId, gameId, commandLog) {
  const compressed = compressCommandLog(commandLog);
  const filename = `${userId}/${gameId}.replay`;

  const { error } = await supabase.storage
    .from('game-saves')
    .upload(filename, compressed, {
      contentType: 'application/octet-stream'
    });

  if (error) throw error;

  // Also save metadata to database
  await supabase.from('game_saves').update({
    command_log: { stored: true, path: filename }
  }).eq('id', gameId);
}
```

---

## 6. Verification (Anti-Cheat)

### 6.1 Server-Side Verification

```javascript
// Edge function or backend service
async function verifyReplay(replayPath) {
  // Download replay
  const { data } = await supabase.storage
    .from('game-saves')
    .download(replayPath);

  const commandLog = decompressCommandLog(await data.arrayBuffer());

  // Create replay player
  const player = new ReplayPlayer();
  player.load(commandLog);

  // Verify
  const result = player.verify();

  return {
    valid: result.valid,
    gameId: commandLog.metadata.gameId,
    tickCount: commandLog.metadata.tickCount,
    finalHash: result.actualHash
  };
}
```

### 6.2 Determinism Requirements

For replay to work correctly:
- [ ] No Math.random() in game logic
- [ ] No Date.now() in game logic
- [ ] Sequential IDs only
- [ ] Fixed iteration order
- [ ] Same seed produces same sequence

---

## 7. UI (Future)

```javascript
// src/UI/components/replay-controls.js
class ReplayControls extends HTMLElement {
  // Play/Pause button
  // Speed selector (0.5x, 1x, 2x, 4x)
  // Progress bar (seekable)
  // Current tick / Total ticks display
}
```

---

*End of Appendix C*