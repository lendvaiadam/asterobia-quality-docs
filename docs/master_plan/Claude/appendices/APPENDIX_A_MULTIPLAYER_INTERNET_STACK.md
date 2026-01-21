# APPENDIX A: MULTIPLAYER & INTERNET STACK

**Parent Document:** [Master Development Plan v1 (Claude)](../MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md)
**Scope:** Transport layer implementation, WebRTC details, signaling protocol, session management

---

## 1. Transport Layer Architecture

### 1.1 ITransport Interface

The transport layer is abstracted behind a common interface to allow swapping implementations without changing game logic.

```typescript
interface ITransport {
  // Connection management
  connect(hostId: string): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;

  // Message passing
  send(message: TransportMessage): void;
  onMessage(handler: (message: TransportMessage) => void): void;

  // Events
  onConnect(handler: () => void): void;
  onDisconnect(handler: (reason: string) => void): void;
  onError(handler: (error: Error) => void): void;

  // Metadata
  getLatency(): number;
  getPeerId(): string;
}

interface TransportMessage {
  type: 'COMMAND' | 'SNAPSHOT' | 'HASH' | 'RESYNC_REQUEST' | 'RESYNC_RESPONSE';
  tick: number;
  payload: any;
  timestamp: number;
}
```

### 1.2 Implementation Hierarchy

```
ITransport (interface)
    |
    +-- LocalTransport (Phase 0: Memory buffer)
    |
    +-- BroadcastChannelTransport (Phase 1: Same-origin tabs)
    |
    +-- WebRTCTransport (Phase 2: Real internet)
    |
    +-- WebSocketTransport (Phase 3: Fallback option)
```

---

## 2. Local Transport (Phase 0)

### 2.1 Purpose

LocalTransport enables development and testing without network complexity. It simulates the transport interface using direct memory references or message queuing.

### 2.2 Implementation

```javascript
// src/SimCore/transport/LocalTransport.js
export class LocalTransport {
  constructor() {
    this.messageQueue = [];
    this.handlers = [];
    this.connected = false;
    this.simulatedLatency = 0; // ms, for testing
  }

  connect(hostId) {
    this.connected = true;
    return Promise.resolve();
  }

  send(message) {
    if (this.simulatedLatency > 0) {
      setTimeout(() => this._deliver(message), this.simulatedLatency);
    } else {
      this._deliver(message);
    }
  }

  _deliver(message) {
    this.handlers.forEach(handler => handler(message));
  }

  onMessage(handler) {
    this.handlers.push(handler);
  }

  // For testing: simulate network conditions
  setLatency(ms) {
    this.simulatedLatency = ms;
  }

  simulatePacketLoss(probability) {
    // Wrap _deliver to randomly drop packets
  }
}
```

### 2.3 Testing Scenarios

| Scenario | Configuration | Expected Behavior |
|----------|---------------|-------------------|
| Ideal network | latency=0, loss=0 | Instant message delivery |
| Moderate latency | latency=50ms | 50ms delay on all messages |
| High latency | latency=200ms | Noticeable but playable |
| Packet loss | loss=5% | Some commands need retry |

---

## 3. BroadcastChannel Transport (Phase 1)

### 3.1 Purpose

BroadcastChannel API enables communication between tabs/windows of the same origin without network infrastructure.

### 3.2 Implementation

```javascript
// src/SimCore/transport/BroadcastChannelTransport.js
export class BroadcastChannelTransport {
  constructor(channelName = 'asterobia-game') {
    this.channel = new BroadcastChannel(channelName);
    this.handlers = [];
    this.peerId = this._generatePeerId();

    this.channel.onmessage = (event) => {
      if (event.data.senderId !== this.peerId) {
        this.handlers.forEach(h => h(event.data.message));
      }
    };
  }

  send(message) {
    this.channel.postMessage({
      senderId: this.peerId,
      message: message
    });
  }

  onMessage(handler) {
    this.handlers.push(handler);
  }

  _generatePeerId() {
    return 'peer_' + Math.random().toString(36).substr(2, 9);
  }
}
```

### 3.3 Limitations

- Same-origin only (same domain/port)
- No cross-device communication
- No persistence if all tabs close
- Limited to same browser

### 3.4 Use Cases

- Development: Host and Client in separate tabs
- Demo: Show multiplayer without backend
- Testing: Fast iteration without network setup

---

## 4. WebRTC Transport (Phase 2)

### 4.1 Overview

WebRTC enables peer-to-peer communication over the internet. For Asterobia, we use DataChannels for game data (not audio/video).

### 4.2 Connection Flow

```
Host                          Signaling (Supabase)                     Client
  |                                    |                                  |
  |-- Create Lobby --------------->    |                                  |
  |                                    |                                  |
  |-- Create PeerConnection            |                                  |
  |-- Create DataChannel               |                                  |
  |-- Create Offer ------------------> | <-- Query Lobbies ---------------|
  |                                    |                                  |
  |                                    | -- Send Offer -----------------> |
  |                                    |                                  |
  |                                    |    Create PeerConnection --------|
  |                                    |    Set Remote Offer -------------|
  |                                    |    Create Answer -----------------|
  |                                    |                                  |
  | <-- Send Answer ------------------- | <-- Send Answer ----------------|
  |                                    |                                  |
  |-- Set Remote Answer                |                                  |
  |                                    |                                  |
  |<============= ICE Candidate Exchange (via Signaling) ================>|
  |                                    |                                  |
  |<==================== DataChannel Connected ==========================>|
  |                                    |                                  |
  |<==================== Game Data (P2P) ================================>|
```

### 4.3 Implementation

```javascript
// src/SimCore/transport/WebRTCTransport.js
export class WebRTCTransport {
  constructor(config = {}) {
    this.config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // TURN servers for NAT traversal fallback
        // { urls: 'turn:turn.example.com', username: '...', credential: '...' }
      ],
      ...config
    };

    this.peerConnection = null;
    this.dataChannel = null;
    this.handlers = [];
    this.connected = false;
  }

  // Host: Create offer and wait for answer
  async createOffer() {
    this.peerConnection = new RTCPeerConnection(this.config);

    this.dataChannel = this.peerConnection.createDataChannel('game', {
      ordered: true, // Commands must be ordered
      maxRetransmits: 3 // Retry dropped packets
    });

    this._setupDataChannel(this.dataChannel);

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await this._waitForIceGathering();

    return this.peerConnection.localDescription;
  }

  // Client: Accept offer and create answer
  async acceptOffer(offer) {
    this.peerConnection = new RTCPeerConnection(this.config);

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this._setupDataChannel(this.dataChannel);
    };

    await this.peerConnection.setRemoteDescription(offer);
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    await this._waitForIceGathering();

    return this.peerConnection.localDescription;
  }

  // Host: Accept client's answer
  async acceptAnswer(answer) {
    await this.peerConnection.setRemoteDescription(answer);
  }

  _setupDataChannel(channel) {
    channel.onopen = () => {
      this.connected = true;
      this._onConnectHandlers.forEach(h => h());
    };

    channel.onclose = () => {
      this.connected = false;
      this._onDisconnectHandlers.forEach(h => h('channel_closed'));
    };

    channel.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handlers.forEach(h => h(message));
    };

    channel.onerror = (error) => {
      this._onErrorHandlers.forEach(h => h(error));
    };
  }

  send(message) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(message));
    }
  }

  async _waitForIceGathering() {
    return new Promise((resolve) => {
      if (this.peerConnection.iceGatheringState === 'complete') {
        resolve();
      } else {
        this.peerConnection.onicegatheringstatechange = () => {
          if (this.peerConnection.iceGatheringState === 'complete') {
            resolve();
          }
        };
      }
    });
  }

  getLatency() {
    // Use RTCPeerConnection.getStats() to measure RTT
    // Implementation depends on browser support
    return this._estimatedLatency || 0;
  }
}
```

### 4.4 ICE/STUN/TURN Configuration

**STUN (Session Traversal Utilities for NAT):**
- Free, public servers available (Google, Mozilla)
- Discovers public IP and port
- Works for most home networks

**TURN (Traversal Using Relays around NAT):**
- Fallback when direct P2P fails
- Relays all traffic through server
- Adds latency but ensures connectivity
- Requires hosted server (cost)

**Recommended Configuration:**
```javascript
const iceServers = [
  // Free STUN servers
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.services.mozilla.com' },

  // TURN fallback (self-hosted or service like Twilio)
  {
    urls: 'turn:turn.asterobia.com:3478',
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL
  }
];
```

### 4.5 DataChannel Configuration

| Parameter | Recommended Value | Rationale |
|-----------|-------------------|-----------|
| `ordered` | `true` | Commands must execute in order |
| `maxRetransmits` | `3` | Retry dropped packets |
| `maxPacketLifeTime` | `null` | Use retransmits instead |

**Message Types and Reliability:**

| Message Type | Ordered | Reliable | Rationale |
|--------------|---------|----------|-----------|
| COMMAND | Yes | Yes | Must not be lost or reordered |
| SNAPSHOT | Yes | Yes | State must be accurate |
| HASH | Yes | Yes | Desync detection critical |
| PING | No | No | Latency measurement, can drop |

---

## 5. Signaling Protocol (Supabase)

### 5.1 Lobby Lifecycle

```
1. Host creates lobby
   INSERT INTO lobbies (host_id, status) VALUES (user_id, 'OPEN')

2. Host generates PeerJS offer
   UPDATE lobbies SET host_offer = offer_sdp WHERE id = lobby_id

3. Client finds lobby
   SELECT * FROM lobbies WHERE status = 'OPEN'

4. Client generates answer
   UPDATE lobbies SET client_answer = answer_sdp WHERE id = lobby_id

5. Host receives answer (via Realtime subscription)
   Connection established

6. Game starts
   UPDATE lobbies SET status = 'PLAYING' WHERE id = lobby_id
```

### 5.2 Supabase Realtime Subscriptions

```javascript
// Host subscribes to lobby changes
const subscription = supabase
  .channel(`lobby:${lobbyId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'lobbies',
    filter: `id=eq.${lobbyId}`
  }, (payload) => {
    if (payload.new.client_answer) {
      // Client submitted answer, complete connection
      transport.acceptAnswer(payload.new.client_answer);
    }
  })
  .subscribe();
```

### 5.3 Error Handling

| Error | Recovery |
|-------|----------|
| Offer timeout | Recreate offer, update lobby |
| Answer timeout | Client retries or picks different lobby |
| ICE failure | Try TURN servers, then fail gracefully |
| Connection drop | Attempt reconnect, then show error |

---

## 6. Session Management

### 6.1 Host Responsibilities

1. **State Authority:** Run SimCore, process commands, broadcast snapshots
2. **Validation:** Reject invalid commands (ownership, cooldowns, etc.)
3. **Synchronization:** Send state hash every 60 ticks
4. **Connection Management:** Track connected clients, handle disconnects

### 6.2 Client Responsibilities

1. **Command Sending:** Queue inputs, send to Host
2. **State Reception:** Receive and apply snapshots
3. **Interpolation:** Smooth visuals between snapshots
4. **Desync Detection:** Compare local hash with Host hash

### 6.3 Disconnect Handling

**Client Disconnects:**
1. Host detects via DataChannel close event
2. Host pauses game (configurable)
3. Host shows reconnection window (30 seconds)
4. If client reconnects: send full snapshot, resume
5. If timeout: remove client, continue or end game

**Host Disconnects:**
1. Clients detect via DataChannel close
2. Game pauses
3. Options:
   - **Host Migration:** Promote client to host (complex)
   - **End Game:** Save state locally, exit gracefully
4. For v1: End game on host disconnect

### 6.4 Late Join Protocol (Future)

```
1. New client requests join
2. Host pauses command processing (not simulation)
3. Host sends full state snapshot
4. Client initializes from snapshot
5. Client sends "ready" signal
6. Host resumes command processing
7. Client is now synchronized
```

---

## 7. Message Protocols

### 7.1 Command Message

```typescript
interface CommandMessage {
  type: 'COMMAND';
  tick: number; // Target tick for execution
  payload: {
    commandType: 'MOVE' | 'STOP' | 'ATTACK' | 'BUILD' | ...;
    playerId: string;
    unitIds: string[];
    data: any; // Command-specific data
  };
}

// Example: Move command
{
  type: 'COMMAND',
  tick: 1205,
  payload: {
    commandType: 'MOVE',
    playerId: 'p_123',
    unitIds: ['u_456', 'u_789'],
    data: {
      targetPosition: { x: 100, y: 0, z: 50 },
      formation: 'LINE'
    }
  }
}
```

### 7.2 Snapshot Message

```typescript
interface SnapshotMessage {
  type: 'SNAPSHOT';
  tick: number;
  payload: {
    entities: Record<string, EntityState>;
    terrain: TerrainState;
    players: Record<string, PlayerState>;
    globals: GlobalState;
  };
}
```

### 7.3 Hash Message

```typescript
interface HashMessage {
  type: 'HASH';
  tick: number;
  payload: {
    stateHash: string; // SHA-256 of serialized state
  };
}
```

### 7.4 Resync Messages

```typescript
interface ResyncRequestMessage {
  type: 'RESYNC_REQUEST';
  tick: number;
  payload: {
    clientHash: string;
    reason: 'HASH_MISMATCH' | 'RECONNECT' | 'LATE_JOIN';
  };
}

interface ResyncResponseMessage {
  type: 'RESYNC_RESPONSE';
  tick: number;
  payload: {
    fullState: SerializedState;
  };
}
```

---

## 8. Bandwidth Optimization

### 8.1 Snapshot Compression

**Strategy: Delta Compression (Phase 2+)**

Instead of sending full state, send only changes since last snapshot.

```javascript
// Delta encoding
const delta = {
  tick: 1206,
  changed: {
    'u_456': { position: [101, 0, 51] }, // Only changed fields
    'u_789': null // Removed entity
  },
  added: {
    'u_999': { /* full entity state */ }
  }
};
```

### 8.2 Interpolation Reduces Bandwidth

By interpolating on the client, we can send snapshots at lower frequency:

| Snapshot Rate | Bandwidth | Visual Quality |
|---------------|-----------|----------------|
| 60 Hz | High | Perfect (no interpolation needed) |
| 20 Hz | Medium | Good with interpolation |
| 10 Hz | Low | Acceptable with interpolation |

**Recommendation:** 10-20 Hz snapshot rate with client interpolation

### 8.3 Priority-Based Sending

Not all entities need the same update frequency:

| Entity Type | Update Priority | Rationale |
|-------------|-----------------|-----------|
| Selected units | High | Player is watching them |
| Nearby units | Medium | May become relevant |
| Distant units | Low | Can update less frequently |
| Static objects | Minimal | Only on state change |

---

## 9. Testing Checklist

### 9.1 Unit Tests

- [ ] LocalTransport delivers messages correctly
- [ ] BroadcastChannelTransport works across tabs
- [ ] WebRTCTransport creates valid offer/answer
- [ ] Message serialization/deserialization correct
- [ ] Hash comparison detects differences

### 9.2 Integration Tests

- [ ] Two tabs can play together via BroadcastChannel
- [ ] Command from Client executes on Host
- [ ] Snapshot from Host updates Client view
- [ ] Desync triggers resync

### 9.3 Manual Tests

- [ ] Connect two browsers on different machines
- [ ] Play 5 minutes without desync
- [ ] Gracefully handle network interruption
- [ ] Reconnect after brief disconnect

---

*End of Appendix A*
