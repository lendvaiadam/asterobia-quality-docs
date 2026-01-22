# APPENDIX F: TESTING, RISKS & OBSERVABILITY

**Parent Document:** [Master Development Plan v1 (Claude)](../MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md)
**Scope:** QA strategy, risk register details, monitoring, debugging tools

---

## 1. Testing Strategy

### 1.1 Test Pyramid

```
                    ┌─────────────┐
                    │   Manual    │  <- Few, expensive
                    │    E2E      │
                    ├─────────────┤
                    │ Integration │  <- Some, medium cost
                    │   Tests     │
                    ├─────────────┤
                    │             │
                    │    Unit     │  <- Many, cheap
                    │   Tests     │
                    │             │
                    └─────────────┘
```

### 1.2 Coverage Targets

| Layer | Target | Focus Areas |
|-------|--------|-------------|
| SimCore | 90% | All logic modules |
| Transport | 80% | Message handling |
| Commands | 90% | All command types |
| State | 85% | Serialization, registry |
| Features | 75% | Core behavior |
| UI | 50% | Critical paths only |

---

## 2. Unit Test Suite

### 2.1 Framework: Jest

```bash
npm install --save-dev jest @babel/preset-env
```

**jest.config.js:**
```javascript
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: [
    'src/SimCore/**/*.js',
    '!src/SimCore/index.js'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80
    }
  }
};
```

### 2.2 Critical Test Categories

#### Determinism Tests

```javascript
// tests/SimCore/determinism.test.js
describe('Determinism', () => {
  test('same inputs produce same outputs', () => {
    const sim1 = new SimCore({ seed: 12345 });
    const sim2 = new SimCore({ seed: 12345 });

    // Apply identical commands
    const commands = [
      createMoveCommand('p1', ['u1'], [100, 0, 0]),
      createMoveCommand('p1', ['u2'], [50, 0, 50])
    ];

    commands.forEach(cmd => {
      sim1.commandQueue.enqueue({ ...cmd });
      sim2.commandQueue.enqueue({ ...cmd });
    });

    // Run for 100 ticks
    for (let i = 0; i < 100; i++) {
      sim1.step();
      sim2.step();
    }

    // Compare states
    const state1 = sim1.serialize();
    const state2 = sim2.serialize();
    expect(state1).toEqual(state2);
  });

  test('different seeds produce different outputs', () => {
    const sim1 = new SimCore({ seed: 12345 });
    const sim2 = new SimCore({ seed: 54321 });

    // Run with randomness
    for (let i = 0; i < 100; i++) {
      sim1.step();
      sim2.step();
    }

    expect(sim1.rng.random()).not.toBe(sim2.rng.random());
  });
});
```

#### Command Processing Tests

```javascript
describe('CommandProcessor', () => {
  test('MOVE command updates unit position', () => {
    const sim = createTestSim();
    const unit = sim.spawnUnit({ position: [0, 0, 0] });

    sim.commandQueue.enqueue(
      createMoveCommand('p1', [unit.id], [100, 0, 0])
    );

    // Advance enough ticks for movement
    for (let i = 0; i < 200; i++) {
      sim.step();
    }

    expect(unit.position[0]).toBeGreaterThan(50);
  });

  test('STOP command halts movement', () => {
    const sim = createTestSim();
    const unit = sim.spawnUnit({ position: [0, 0, 0] });

    sim.commandQueue.enqueue(
      createMoveCommand('p1', [unit.id], [100, 0, 0])
    );

    // Move for a bit
    for (let i = 0; i < 10; i++) sim.step();

    const positionBeforeStop = [...unit.position];

    sim.commandQueue.enqueue(
      createStopCommand('p1', [unit.id])
    );

    // Continue stepping
    for (let i = 0; i < 10; i++) sim.step();

    expect(unit.position).toEqual(positionBeforeStop);
  });

  test('invalid command is rejected', () => {
    const sim = createTestSim();
    const unit = sim.spawnUnit({ ownerId: 'p1' });

    // Player 2 tries to move Player 1's unit
    sim.commandQueue.enqueue(
      createMoveCommand('p2', [unit.id], [100, 0, 0])
    );

    const prevPosition = [...unit.position];
    sim.step();

    expect(unit.position).toEqual(prevPosition);
  });
});
```

#### State Serialization Tests

```javascript
describe('Serialization', () => {
  test('serialize and deserialize produces identical state', () => {
    const sim = createTestSim();

    // Add some entities and run
    sim.spawnUnit({ position: [10, 0, 20] });
    sim.spawnUnit({ position: [30, 0, 40] });
    for (let i = 0; i < 50; i++) sim.step();

    // Serialize
    const serialized = sim.serialize();

    // Create new sim and deserialize
    const sim2 = new SimCore({ seed: 0 }); // Different seed
    sim2.deserialize(serialized);

    // Compare
    expect(sim2.tick).toBe(sim.tick);
    expect(sim2.entities.size).toBe(sim.entities.size);
    expect(sim2.serialize()).toEqual(serialized);
  });

  test('save/load preserves game state across sessions', () => {
    const sim = createTestSim();
    sim.spawnUnit({ position: [50, 0, 50] });
    for (let i = 0; i < 100; i++) sim.step();

    // Save to "storage"
    const saved = sim.serialize();

    // "New session"
    const sim2 = new SimCore({ seed: 99999 });
    sim2.deserialize(saved);

    // Continue game
    for (let i = 0; i < 100; i++) sim2.step();

    expect(sim2.tick).toBe(200);
  });
});
```

---

## 3. Integration Tests

### 3.1 Multi-Instance Tests

```javascript
// tests/integration/multiplayer.test.js
describe('Multiplayer Simulation', () => {
  test('host and client stay synchronized', async () => {
    const host = new SimCore({ seed: 42, isHost: true });
    const client = new SimCore({ seed: 42, isHost: false });

    const transport = new MockTransport();
    host.setTransport(transport.hostSide);
    client.setTransport(transport.clientSide);

    // Client sends command
    const command = createMoveCommand('p2', ['u1'], [100, 0, 0]);
    client.sendCommand(command);

    // Simulate network
    await transport.flush();

    // Host processes
    host.step();

    // Host broadcasts snapshot
    await transport.flush();

    // Client receives
    client.applySnapshot(transport.lastSnapshot);

    // Verify sync
    expect(host.getEntity('u1').position)
      .toEqual(client.getEntity('u1').position);
  });
});
```

### 3.2 Feature Integration Tests

```javascript
describe('MOVE_ROLL Integration', () => {
  test('unit respects slope constraints', () => {
    const sim = createTestSimWithTerrain();
    const unit = sim.spawnUnit({
      position: [0, 0, 0],
      features: { 'MOVE_ROLL': { allocation: 50 } }
    });

    // Command to move up steep slope (>60°)
    sim.commandQueue.enqueue(
      createMoveCommand('p1', [unit.id], [0, 100, 0]) // Vertical climb
    );

    for (let i = 0; i < 100; i++) sim.step();

    // Unit should be blocked
    expect(unit.status).toBe('BLOCKED');
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'BLOCKED_BY_SLOPE' })
    );
  });
});
```

---

## 4. Performance Testing

### 4.1 Tick Time Benchmarks

```javascript
describe('Performance', () => {
  test('tick completes under 8ms with 50 units', () => {
    const sim = createTestSim();

    // Spawn 50 units
    for (let i = 0; i < 50; i++) {
      sim.spawnUnit({ position: [i * 10, 0, 0] });
    }

    // Measure tick time
    const times = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      sim.step();
      times.push(performance.now() - start);
    }

    const p95 = times.sort()[Math.floor(times.length * 0.95)];
    expect(p95).toBeLessThan(8);
  });

  test('serialization under 50ms with 100 entities', () => {
    const sim = createTestSim();
    for (let i = 0; i < 100; i++) {
      sim.spawnUnit({ position: [i * 10, 0, 0] });
    }

    const start = performance.now();
    const serialized = sim.serialize();
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(50);
    expect(serialized.length).toBeLessThan(100000); // <100KB
  });
});
```

### 4.2 Memory Profiling

Run periodically:
```bash
node --expose-gc tests/memory-profile.js
```

```javascript
// tests/memory-profile.js
global.gc();
const initialMemory = process.memoryUsage().heapUsed;

const sim = new SimCore({ seed: 42 });

// Simulate 10 minutes of gameplay
for (let i = 0; i < 12000; i++) { // 20Hz * 60s * 10min
  sim.step();
  if (i % 1000 === 0) {
    global.gc();
    const mem = (process.memoryUsage().heapUsed - initialMemory) / 1024 / 1024;
    console.log(`Tick ${i}: ${mem.toFixed(2)} MB`);
  }
}

// Memory should not grow unboundedly
global.gc();
const finalMemory = (process.memoryUsage().heapUsed - initialMemory) / 1024 / 1024;
console.log(`Final: ${finalMemory.toFixed(2)} MB`);

if (finalMemory > 50) {
  console.error('MEMORY LEAK SUSPECTED');
  process.exit(1);
}
```

---

## 5. Manual Testing Procedures

### 5.1 Smoke Test Checklist

**Quick Smoke (Before Every Commit):**

```
[ ] npm start runs without errors
[ ] Game loads at localhost:8081
[ ] Can click unit to select
[ ] Can issue move command
[ ] Unit moves to destination
```

**Full Smoke (Before Each Release):**

```
[ ] All Quick Smoke items
[ ] Camera: Pan, orbit, zoom work
[ ] Camera: Fly-to animation smooth
[ ] Path: Can draw multi-waypoint path
[ ] Path: Can edit waypoints
[ ] Path: Closed loop works
[ ] FOW: Unexplored areas dark
[ ] FOW: Visible areas bright
[ ] FOW: Explored areas dimmed
[ ] Multi-unit: Can select multiple
[ ] Multi-unit: All respond to commands
[ ] Performance: 60 FPS with 10 units
[ ] No console errors during gameplay
```

### 5.2 Multiplayer Test Procedure

```
1. Open two browser windows
2. In Window 1: Create lobby (host)
3. In Window 2: Join lobby (client)
4. Verify connection established
5. Host: Select unit, issue move
6. Verify: Unit moves in both windows
7. Client: Select unit, issue move
8. Verify: Unit moves in both windows
9. Wait 5 minutes
10. Verify: No desync (units in same positions)
11. Host: Save game
12. Both: Verify same game state
```

---

## 6. Risk Register (Detailed)

### 6.1 Risk 001: Performance Ceiling

**ID:** RISK-001
**Category:** Technical
**Probability:** Medium (40%)
**Impact:** High

**Description:**
JavaScript single-threaded nature may cause frame drops when SimCore.step() exceeds 10ms.

**Triggers:**
- Unit count > 50
- Complex pathfinding requests
- Large state serialization

**Indicators:**
- Tick time p95 > 5ms (warning)
- Tick time p95 > 8ms (critical)
- Console warnings about dropped frames

**Mitigations:**
1. **Immediate:** Time budget with early abort
2. **Short-term:** Move SimCore to Web Worker
3. **Long-term:** WASM for physics calculations

**Contingency:**
- Reduce unit cap
- Simplify pathfinding
- Increase tick interval (15Hz)

---

### 6.2 Risk 002: Determinism Drift

**ID:** RISK-002
**Category:** Technical
**Probability:** High (60%)
**Impact:** Critical

**Description:**
Floating-point variance between browsers/machines causes state divergence in multiplayer.

**Triggers:**
- Extended gameplay sessions
- Complex physics calculations
- Different CPU architectures

**Indicators:**
- State hash mismatch
- Visual desync (units in different positions)
- Resync requests > 1 per minute

**Mitigations:**
1. **Immediate:** State hash comparison every 60 ticks
2. **Short-term:** Automatic resync on mismatch
3. **Long-term:** Fixed-point math library

**Contingency:**
- Increase resync frequency
- Reduce gameplay complexity
- Server-authoritative mode

---

### 6.3 Risk 003: Unit.js Monolith

**ID:** RISK-003
**Category:** Technical Debt
**Probability:** High (70%)
**Impact:** Medium

**Description:**
Tightly coupled Unit.js (~1500 lines) makes extraction to SimCore risky.

**Triggers:**
- Any modification to Unit.js
- State extraction attempts
- Feature additions

**Indicators:**
- Smoke test failures after Unit.js changes
- Unexpected behavior changes
- Regression bugs

**Mitigations:**
1. **Immediate:** Never modify Unit.js without full smoke test
2. **Short-term:** Incremental extraction via shims
3. **Long-term:** Complete rewrite in SimCore

**Contingency:**
- Revert changes immediately on failure
- Document all dependencies
- Pair programming for Unit.js changes

---

### 6.4 Risk 004: WebRTC NAT Traversal

**ID:** RISK-004
**Category:** Network
**Probability:** Medium (30%)
**Impact:** Medium

**Description:**
Symmetric NAT and firewall configurations prevent P2P connection.

**Triggers:**
- Corporate networks
- Strict router configurations
- Mobile carriers

**Indicators:**
- Connection timeout > 10 seconds
- ICE gathering fails
- TURN fallback usage > 20%

**Mitigations:**
1. **Immediate:** Use free STUN servers
2. **Short-term:** Deploy TURN servers
3. **Long-term:** WebSocket fallback

**Contingency:**
- TURN server for all connections (higher latency)
- Display connection quality indicator
- Suggest network troubleshooting

---

## 7. Observability

### 7.1 Debug Overlay

```javascript
// src/UI/DebugOverlay.js
export class DebugOverlay {
  constructor(simCore, renderer) {
    this.simCore = simCore;
    this.renderer = renderer;
    this.visible = false;
    this.metrics = {};
  }

  update() {
    this.metrics = {
      tick: this.simCore.tick,
      fps: this.renderer.getFPS(),
      tickTime: this.simCore.lastTickDuration.toFixed(2) + 'ms',
      entities: this.simCore.entities.size,
      commands: this.simCore.commandQueue.pending.length,
      memory: (performance.memory?.usedJSHeapSize / 1024 / 1024).toFixed(1) + 'MB'
    };
  }

  render() {
    if (!this.visible) return;

    // Draw overlay
    const lines = [
      `Tick: ${this.metrics.tick}`,
      `FPS: ${this.metrics.fps}`,
      `Tick Time: ${this.metrics.tickTime}`,
      `Entities: ${this.metrics.entities}`,
      `Pending Commands: ${this.metrics.commands}`,
      `Memory: ${this.metrics.memory}`
    ];

    // Render to screen corner
  }
}
```

### 7.2 Event Logging

```javascript
// src/SimCore/debug/EventLogger.js
export class EventLogger {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.log = [];
    this.maxEntries = 1000;

    eventBus.on('*', this.onEvent.bind(this));
  }

  onEvent(event) {
    this.log.push({
      time: Date.now(),
      tick: this.simCore?.tick,
      type: event.type,
      data: event.data
    });

    if (this.log.length > this.maxEntries) {
      this.log.shift();
    }
  }

  export() {
    return JSON.stringify(this.log, null, 2);
  }

  filter(eventType) {
    return this.log.filter(e => e.type === eventType);
  }
}
```

### 7.3 State Comparison Tool

```javascript
// src/SimCore/debug/StateComparator.js
export class StateComparator {
  static compare(state1, state2) {
    const diff = {
      tick: state1.tick !== state2.tick,
      seed: state1.seed !== state2.seed,
      entities: [],
      missing1: [],
      missing2: []
    };

    const ids1 = new Set(Object.keys(state1.entities));
    const ids2 = new Set(Object.keys(state2.entities));

    // Find missing entities
    for (const id of ids1) {
      if (!ids2.has(id)) diff.missing2.push(id);
    }
    for (const id of ids2) {
      if (!ids1.has(id)) diff.missing1.push(id);
    }

    // Compare common entities
    for (const id of ids1) {
      if (!ids2.has(id)) continue;

      const e1 = state1.entities[id];
      const e2 = state2.entities[id];

      const entityDiff = this.compareEntities(e1, e2);
      if (entityDiff) {
        diff.entities.push({ id, diff: entityDiff });
      }
    }

    return diff;
  }

  static compareEntities(e1, e2) {
    const diffs = [];

    // Compare positions
    const posDiff = Math.abs(e1.position[0] - e2.position[0]) +
                    Math.abs(e1.position[1] - e2.position[1]) +
                    Math.abs(e1.position[2] - e2.position[2]);

    if (posDiff > 0.001) {
      diffs.push({ field: 'position', v1: e1.position, v2: e2.position });
    }

    // Compare other fields...

    return diffs.length > 0 ? diffs : null;
  }
}
```

---

## 8. Error Recovery Procedures

### 8.1 Desync Recovery

```
1. Detect: State hash mismatch from host
2. Log: Record local state and commands
3. Request: Ask host for full snapshot
4. Pause: Freeze local simulation
5. Receive: Get authoritative state
6. Replace: Overwrite local state
7. Resume: Continue simulation
8. Notify: Brief UI indication
```

### 8.2 Connection Loss Recovery

```
1. Detect: DataChannel close event
2. Pause: Freeze game simulation
3. Display: "Reconnecting..." UI
4. Retry: Attempt reconnection (3 tries)
5. Success: Request state sync, resume
6. Failure: Offer save and exit
```

### 8.3 Crash Recovery

```
1. Autosave: Every 60 seconds to localStorage
2. Detect: beforeunload event
3. Quick save: Attempt emergency save
4. Next load: Detect crash flag
5. Offer: "Resume from autosave?"
6. Load: Deserialize and continue
```

---

*End of Appendix F*
