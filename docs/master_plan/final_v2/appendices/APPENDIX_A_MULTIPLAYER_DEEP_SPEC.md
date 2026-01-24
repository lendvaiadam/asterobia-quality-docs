# APPENDIX A: MULTIPLAYER DEEP SPEC

**Parent Document:** [MASTER_PLAN_FINAL_v2.md](../MASTER_PLAN_FINAL_v2.md)
**Scope:** Complete multiplayer architecture, connection flow, state sync, host authority

---

## 1. Architecture Overview

### 1.1 Host-Authoritative Star Topology

**Decision:** Per Human Owner Q10 - Host is "server-shaped" for future dedicated server migration.

```
                    ┌─────────────────┐
                    │      HOST       │
                    │   (Authority)   │
                    │                 │
                    │  ┌───────────┐  │
                    │  │ SimCore   │  │
                    │  │(20Hz tick)│  │
                    │  └───────────┘  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Client 1 │   │ Client 2 │   │ Client 3 │
        │          │   │          │   │          │
        │ SimCore  │   │ SimCore  │   │ SimCore  │
        │(Predict) │   │(Predict) │   │(Predict) │
        └──────────┘   └──────────┘   └──────────┘
```

### 1.2 Key Properties

| Property | Value | Rationale |
|----------|-------|-----------|
| Max Players | 4 | Per Q10; manageable for P2P mesh fallback |
| Authority | Host | All state changes validated by host |
| Prediction | Client-side | Smooth local feel |
| Correction | Server reconciliation | Host state is truth |
| Tick Rate | 20 Hz | Shared across all instances |
| Snapshot Rate | ~6.67 Hz (every 3 ticks) | Balance bandwidth vs smoothness |

---

## 2. Connection Flow

### 2.1 Lobby Creation (Host)

```javascript
// src/backend/LobbyManager.js
async function createLobby(userId, lobbyName) {
  // 1. Create lobby in Supabase
  const { data: lobby, error } = await supabase
    .from('lobbies')
    .insert({
      host_id: userId,
      name: lobbyName,
      max_players: 4,
      current_players: 1,
      status: 'waiting'
    })
    .select()
    .single();

  if (error) throw error;

  // 2. Subscribe to lobby channel for signaling
  const channel = supabase.channel(`lobby:${lobby.id}`);
  channel.subscribe();

  // 3. Listen for join requests
  channel.on('broadcast', { event: 'join_request' }, handleJoinRequest);

  return { lobby, channel };
}
```

### 2.2 Lobby Join (Client)

```javascript
async function joinLobby(userId, lobbyId) {
  // 1. Add to lobby_members
  await supabase
    .from('lobby_members')
    .insert({ lobby_id: lobbyId, user_id: userId });

  // 2. Subscribe to lobby channel
  const channel = supabase.channel(`lobby:${lobbyId}`);
  channel.subscribe();

  // 3. Send join request
  channel.send({
    type: 'broadcast',
    event: 'join_request',
    payload: { userId }
  });

  // 4. Wait for host's WebRTC offer
  return new Promise((resolve) => {
    channel.on('broadcast', { event: 'webrtc_offer' }, (payload) => {
      if (payload.targetUserId === userId) {
        resolve(payload.offer);
      }
    });
  });
}
```

### 2.3 WebRTC Signaling

```javascript
// Host: Create offer for new client
async function createOffer(channel, clientUserId) {
  const pc = new RTCPeerConnection(rtcConfig);

  // Create DataChannel
  const dc = pc.createDataChannel('game', { ordered: true });
  setupDataChannel(dc, clientUserId);

  // Create and send offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Send offer via Supabase
  channel.send({
    type: 'broadcast',
    event: 'webrtc_offer',
    payload: {
      targetUserId: clientUserId,
      offer: pc.localDescription
    }
  });

  // Listen for answer
  channel.on('broadcast', { event: 'webrtc_answer' }, async (payload) => {
    if (payload.fromUserId === clientUserId) {
      await pc.setRemoteDescription(payload.answer);
    }
  });

  // ICE candidates
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      channel.send({
        type: 'broadcast',
        event: 'ice_candidate',
        payload: {
          targetUserId: clientUserId,
          candidate: e.candidate
        }
      });
    }
  };

  return pc;
}

// Client: Respond to offer
async function handleOffer(channel, offer, userId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.ondatachannel = (e) => {
    setupDataChannel(e.channel, 'host');
  };

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  channel.send({
    type: 'broadcast',
    event: 'webrtc_answer',
    payload: {
      fromUserId: userId,
      answer: pc.localDescription
    }
  });

  return pc;
}
```

### 2.4 RTC Configuration

```javascript
const rtcConfig = {
  iceServers: [
    // STUN servers (free)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // TURN servers (for NAT traversal)
    // Per Q11: TURN-only fallback
    {
      urls: 'turn:turn.example.com:3478',
      username: 'asterobia',
      credential: process.env.TURN_CREDENTIAL
    }
  ]
};
```

---

## 3. Message Protocol

### 3.1 Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `COMMAND` | Client → Host | Player input |
| `SNAPSHOT` | Host → Client | Authoritative state |
| `HASH_CHECK` | Host → Client | State verification |
| `RESYNC_REQUEST` | Client → Host | Request full state |
| `FULL_STATE` | Host → Client | Complete state transfer |
| `PLAYER_JOIN` | Host → All | New player notification |
| `PLAYER_LEAVE` | Host → All | Player disconnect |

### 3.2 Message Schemas

```javascript
// Command message (client to host)
const commandMessage = {
  type: 'COMMAND',
  seq: 123,              // Sequence number for ack
  command: {
    type: 'MOVE',
    playerId: 'p1',
    unitIds: ['u1', 'u2'],
    tick: 500,           // Target tick
    payload: {
      targetPosition: [100, 0, 50]
    }
  }
};

// Snapshot message (host to clients)
const snapshotMessage = {
  type: 'SNAPSHOT',
  tick: 500,
  stateHash: 'abc123',   // For verification
  delta: {               // Only changed entities
    entities: {
      'u1': { position: [105, 0, 52], /* ... */ }
    },
    removed: ['u5']      // Destroyed entities
  },
  commands: [            // Commands applied this tick (for replay)
    { type: 'MOVE', playerId: 'p1', /* ... */ }
  ]
};

// Hash check message
const hashCheckMessage = {
  type: 'HASH_CHECK',
  tick: 600,
  stateHash: 'def456'
};
```

### 3.3 Binary Encoding (Optimization)

For bandwidth efficiency, use MessagePack or similar:

```javascript
import { encode, decode } from '@msgpack/msgpack';

function sendMessage(dc, message) {
  const binary = encode(message);
  dc.send(binary);
}

function receiveMessage(event) {
  const message = decode(event.data);
  return message;
}
```

---

## 4. State Synchronization

### 4.1 Host Loop

```javascript
// src/SimCore/multiplayer/HostController.js
class HostController {
  constructor(simCore, transport) {
    this.simCore = simCore;
    this.transport = transport;
    this.clients = new Map();     // clientId -> ClientState
    this.pendingCommands = [];    // Commands from clients
    this.lastSnapshotTick = 0;
    this.SNAPSHOT_INTERVAL = 3;   // Every 3 ticks
    this.HASH_CHECK_INTERVAL = 60;
  }

  tick() {
    // 1. Collect commands from clients
    for (const cmd of this.pendingCommands) {
      this.simCore.commandQueue.enqueue(cmd);
    }
    this.pendingCommands = [];

    // 2. Step SimCore
    this.simCore.step();

    // 3. Send snapshot
    if (this.simCore.tick - this.lastSnapshotTick >= this.SNAPSHOT_INTERVAL) {
      this.broadcastSnapshot();
      this.lastSnapshotTick = this.simCore.tick;
    }

    // 4. Hash check
    if (this.simCore.tick % this.HASH_CHECK_INTERVAL === 0) {
      this.broadcastHashCheck();
    }
  }

  broadcastSnapshot() {
    const snapshot = {
      type: 'SNAPSHOT',
      tick: this.simCore.tick,
      stateHash: this.simCore.getStateHash(),
      delta: this.simCore.getDeltaSinceLastSnapshot(),
      commands: this.simCore.commandLog.getCommandsSince(this.lastSnapshotTick)
    };

    for (const client of this.clients.values()) {
      client.send(snapshot);
    }
  }

  onClientCommand(clientId, command) {
    // Validate command
    if (!this.validateCommand(clientId, command)) {
      console.warn('Invalid command from client', clientId);
      return;
    }

    this.pendingCommands.push(command);
  }

  validateCommand(clientId, command) {
    // Check player owns the units
    const client = this.clients.get(clientId);
    for (const unitId of command.unitIds) {
      const unit = this.simCore.getEntity(unitId);
      if (!unit || unit.ownerId !== client.playerId) {
        return false;
      }
    }
    return true;
  }
}
```

### 4.2 Client Loop

```javascript
// src/SimCore/multiplayer/ClientController.js
class ClientController {
  constructor(simCore, transport) {
    this.simCore = simCore;
    this.transport = transport;
    this.serverTick = 0;
    this.pendingInputs = [];      // For client prediction rollback
    this.commandSeq = 0;
  }

  tick() {
    // 1. Client-side prediction (optional for Demo 1.0)
    // For simplicity, just wait for server snapshots

    // 2. Interpolate entities for smooth visuals
    this.interpolateEntities();
  }

  sendCommand(command) {
    command.seq = this.commandSeq++;
    command.tick = this.serverTick + this.getTickDelay();

    this.transport.send({
      type: 'COMMAND',
      seq: command.seq,
      command
    });

    // Store for potential rollback
    this.pendingInputs.push(command);
  }

  onSnapshot(snapshot) {
    this.serverTick = snapshot.tick;

    // Apply authoritative state
    this.simCore.applyDelta(snapshot.delta);

    // Verify hash
    const localHash = this.simCore.getStateHash();
    if (localHash !== snapshot.stateHash) {
      console.warn('State mismatch, requesting resync');
      this.requestResync();
    }
  }

  onHashCheck(message) {
    const localHash = this.simCore.getStateHashAt(message.tick);
    if (localHash !== message.stateHash) {
      this.requestResync();
    }
  }

  requestResync() {
    this.transport.send({ type: 'RESYNC_REQUEST' });
  }

  onFullState(state) {
    this.simCore.loadState(state);
    this.pendingInputs = [];
  }

  interpolateEntities() {
    const alpha = this.simCore.getInterpolationAlpha();
    for (const entity of this.simCore.entities.values()) {
      if (entity.prevPosition && entity.position) {
        entity.renderPosition.lerpVectors(
          entity.prevPosition,
          entity.position,
          alpha
        );
      }
    }
  }
}
```

---

## 5. Late Join

### 5.1 Join Flow

```
1. New client connects via WebRTC
2. Client sends: { type: 'JOIN_REQUEST', userId }
3. Host pauses command processing (brief)
4. Host sends: { type: 'FULL_STATE', state: simCore.serialize() }
5. Client loads state
6. Host resumes
7. Client begins receiving snapshots
```

### 5.2 Implementation

```javascript
// Host handling late join
onJoinRequest(clientId, userId) {
  // 1. Create player state
  const playerId = this.simCore.idGenerator.next('p');
  this.clients.set(clientId, {
    userId,
    playerId,
    dc: /* DataChannel */,
    send: (msg) => /* send to client */
  });

  // 2. Spawn initial unit for new player
  const centralUnit = this.simCore.spawnUnit({
    typeId: 'TYPE_CENTRAL',
    position: this.getSpawnPosition(),
    ownerId: playerId
  });

  // 3. Send full state
  const fullState = this.simCore.serialize();
  this.clients.get(clientId).send({
    type: 'FULL_STATE',
    state: fullState,
    yourPlayerId: playerId
  });

  // 4. Notify other clients
  this.broadcast({
    type: 'PLAYER_JOIN',
    playerId,
    displayName: /* from userId lookup */
  }, clientId); // Exclude joining client
}
```

---

## 6. Disconnection Handling

### 6.1 Detection

```javascript
// DataChannel events
dc.onclose = () => handleDisconnect(clientId);
dc.onerror = () => handleDisconnect(clientId);

// Heartbeat timeout
setInterval(() => {
  for (const [clientId, client] of clients) {
    if (Date.now() - client.lastHeartbeat > 10000) {
      handleDisconnect(clientId);
    }
  }
}, 5000);
```

### 6.2 Graceful Disconnect

```javascript
function handleDisconnect(clientId) {
  const client = clients.get(clientId);
  if (!client) return;

  // 1. Mark player's units as AI-controlled or pause
  for (const unit of simCore.getUnitsByOwner(client.playerId)) {
    unit.aiControlled = true; // Or pause
  }

  // 2. Remove client
  clients.delete(clientId);

  // 3. Notify others
  broadcast({
    type: 'PLAYER_LEAVE',
    playerId: client.playerId
  });

  // 4. If host disconnected, initiate host migration
  if (isHost(clientId)) {
    initiateHostMigration();
  }
}
```

### 6.3 Host Migration

```javascript
function initiateHostMigration() {
  // 1. Determine new host (lowest player ID or longest connected)
  const newHostId = selectNewHost();

  // 2. Current host sends migration message
  broadcast({
    type: 'HOST_MIGRATION',
    newHostId,
    finalState: simCore.serialize()
  });

  // 3. New host takes over
  // (All clients reconnect to new host via Supabase signaling)
}
```

---

## 7. Bandwidth Optimization

### 7.1 Delta Compression

Only send changed entity properties:

```javascript
function computeDelta(prevSnapshot, currentState) {
  const delta = { entities: {}, removed: [] };

  for (const [id, entity] of currentState.entities) {
    const prev = prevSnapshot.entities.get(id);
    if (!prev) {
      // New entity
      delta.entities[id] = entity;
    } else {
      // Check for changes
      const changes = {};
      if (!vectorEquals(prev.position, entity.position)) {
        changes.position = entity.position;
      }
      if (prev.hp !== entity.hp) {
        changes.hp = entity.hp;
      }
      // ... other fields

      if (Object.keys(changes).length > 0) {
        delta.entities[id] = changes;
      }
    }
  }

  // Check for removed entities
  for (const id of prevSnapshot.entities.keys()) {
    if (!currentState.entities.has(id)) {
      delta.removed.push(id);
    }
  }

  return delta;
}
```

### 7.2 Interest Management (Future)

For larger player counts, send only relevant entities:

```javascript
function getRelevantEntities(player) {
  const visibleArea = player.getVisibleArea();
  return entities.filter(e => visibleArea.contains(e.position));
}
```

---

## 8. Testing Multiplayer

### 8.1 Local Testing (Multiple Tabs)

```javascript
// Use BroadcastChannel for local testing without network
const channel = new BroadcastChannel('asterobia-local-mp');

// Mock transport
class LocalMultiplayerTransport {
  constructor(playerId) {
    this.playerId = playerId;
    this.channel = new BroadcastChannel('asterobia-local-mp');
    this.onMessage = null;

    this.channel.onmessage = (e) => {
      if (e.data.targetPlayerId === this.playerId || !e.data.targetPlayerId) {
        this.onMessage?.(e.data);
      }
    };
  }

  send(message) {
    this.channel.postMessage({ ...message, fromPlayerId: this.playerId });
  }
}
```

### 8.2 Integration Test

```javascript
describe('Multiplayer Sync', () => {
  test('host and client stay synchronized for 5 minutes', async () => {
    const host = createHostInstance();
    const client = createClientInstance();

    // Connect
    await connectClientToHost(client, host);

    // Run for 5 minutes (6000 ticks at 20Hz)
    for (let i = 0; i < 6000; i++) {
      // Random commands
      if (i % 100 === 0) {
        client.sendCommand(createRandomMoveCommand());
      }

      host.tick();
      await flushNetwork();
      client.tick();

      // Verify sync every 60 ticks
      if (i % 60 === 0) {
        expect(host.simCore.getStateHash())
          .toBe(client.simCore.getStateHash());
      }
    }
  });
});
```

---

## 9. Security Considerations

### 9.1 Command Validation (Host)

```javascript
function validateCommand(clientId, command) {
  const client = clients.get(clientId);

  // 1. Check player owns units
  for (const unitId of command.unitIds) {
    const unit = simCore.getEntity(unitId);
    if (!unit || unit.ownerId !== client.playerId) {
      return { valid: false, reason: 'UNIT_NOT_OWNED' };
    }
  }

  // 2. Check command is possible (unit has feature)
  if (command.type === 'MINE') {
    const unit = simCore.getEntity(command.unitIds[0]);
    if (!unit.hasFeature('MATERA_MINING')) {
      return { valid: false, reason: 'MISSING_FEATURE' };
    }
  }

  // 3. Rate limiting
  if (client.commandsThisTick > 10) {
    return { valid: false, reason: 'RATE_LIMITED' };
  }

  return { valid: true };
}
```

### 9.2 Replay Verification (Anti-Cheat Foundation)

Per Human Owner Q1: Command log enables replay verification.

```javascript
// Server-side verification (future)
async function verifyGameReplay(commandLog, finalStateHash) {
  const sim = new SimCore({ seed: commandLog.seed });

  for (const cmd of commandLog.commands) {
    while (sim.tick < cmd.tick) {
      sim.step();
    }
    sim.commandQueue.enqueue(cmd);
  }

  sim.step(); // Final step

  return sim.getStateHash() === finalStateHash;
}
```

---

*End of Appendix A*