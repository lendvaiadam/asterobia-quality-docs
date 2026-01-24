# APPENDIX G: TESTING & QA STRATEGY

**Parent Document:** [MASTER_PLAN_FINAL_v2.md](../MASTER_PLAN_FINAL_v2.md)
**Decision:** Per Human Owner Q13 - Unit + Integration testing
**Scope:** Test pyramid, coverage targets, CI pipeline, performance testing

---

## 1. Test Pyramid

```
            ┌─────────────────┐
            │    Manual       │  <- Few, expensive, full smoke
            │    E2E          │
            ├─────────────────┤
            │  Integration    │  <- Some, medium cost
            │    Tests        │
            ├─────────────────┤
            │                 │
            │    Unit         │  <- Many, cheap, fast
            │    Tests        │
            │                 │
            └─────────────────┘
```

---

## 2. Coverage Targets

| Component | Target | Focus Areas |
|-----------|--------|-------------|
| SimCore/core | 90% | GameLoop, IdGenerator, PRNG |
| SimCore/commands | 90% | All command types |
| SimCore/state | 85% | Serialization, registry |
| SimCore/features | 75% | Core behavior |
| SimCore/transport | 70% | Message handling |
| UI components | 30% | Critical paths only |

---

## 3. Unit Tests

### 3.1 Framework: Jest

```javascript
// jest.config.js
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
      branches: 70,
      functions: 70,
      lines: 75
    }
  }
};
```

### 3.2 Critical Test Categories

#### Determinism Tests

```javascript
describe('Determinism', () => {
  test('same seed + same commands = same state', () => {
    const sim1 = new SimCore({ seed: 12345 });
    const sim2 = new SimCore({ seed: 12345 });

    const commands = [
      createMoveCommand('p1', ['u1'], [100, 0, 0]),
      createMoveCommand('p1', ['u2'], [50, 0, 50])
    ];

    commands.forEach(cmd => {
      sim1.commandQueue.enqueue({ ...cmd });
      sim2.commandQueue.enqueue({ ...cmd });
    });

    for (let i = 0; i < 1000; i++) {
      sim1.step();
      sim2.step();
    }

    expect(sim1.getStateHash()).toBe(sim2.getStateHash());
  });

  test('different seeds = different states', () => {
    const sim1 = new SimCore({ seed: 12345 });
    const sim2 = new SimCore({ seed: 54321 });

    for (let i = 0; i < 100; i++) {
      sim1.step();
      sim2.step();
    }

    expect(sim1.rng.random()).not.toBe(sim2.rng.random());
  });
});
```

#### Command Tests

```javascript
describe('CommandProcessor', () => {
  test('MOVE command updates position', () => {
    const sim = createTestSim();
    const unit = sim.spawnUnit({ position: [0, 0, 0] });

    sim.commandQueue.enqueue(
      createMoveCommand('p1', [unit.id], [100, 0, 0])
    );

    for (let i = 0; i < 200; i++) sim.step();

    expect(unit.position[0]).toBeGreaterThan(50);
  });

  test('invalid command rejected', () => {
    const sim = createTestSim();
    const unit = sim.spawnUnit({ ownerId: 'p1' });

    // Wrong owner
    sim.commandQueue.enqueue(
      createMoveCommand('p2', [unit.id], [100, 0, 0])
    );

    const prevPos = [...unit.position];
    sim.step();

    expect(unit.position).toEqual(prevPos);
  });
});
```

#### Serialization Tests

```javascript
describe('Serialization', () => {
  test('round-trip produces identical state', () => {
    const sim = createTestSim();
    sim.spawnUnit({ position: [10, 0, 20] });

    for (let i = 0; i < 50; i++) sim.step();

    const serialized = sim.serialize();
    const sim2 = new SimCore({ seed: 0 });
    sim2.deserialize(serialized);

    expect(sim2.getStateHash()).toBe(sim.getStateHash());
  });
});
```

---

## 4. Integration Tests

### 4.1 Multiplayer Sync

```javascript
describe('Multiplayer', () => {
  test('host and client stay synchronized', async () => {
    const host = new SimCore({ seed: 42, isHost: true });
    const client = new SimCore({ seed: 42, isHost: false });
    const transport = new MockTransport();

    host.setTransport(transport.hostSide);
    client.setTransport(transport.clientSide);

    // Client sends command
    client.sendCommand(createMoveCommand('p2', ['u1'], [100, 0, 0]));
    await transport.flush();

    host.step();
    await transport.flush();

    client.applySnapshot(transport.lastSnapshot);

    expect(host.getEntity('u1').position)
      .toEqual(client.getEntity('u1').position);
  });
});
```

### 4.2 Feature Integration

```javascript
describe('GRFDTRDPU Integration', () => {
  test('full pipeline Goal -> Unit', async () => {
    const sim = new SimCore({ seed: 42 });

    // G: Trigger goal
    sim.eventBus.emit('UNIT_STUCK', { unitId: 'central' });
    expect(sim.goalManager.goals.size).toBe(1);

    // R: Research
    const goal = [...sim.goalManager.goals.values()][0];
    const job = sim.researchManager.startResearch(goal.id, 'central');
    while (job.status !== 'DONE') sim.step();

    // F: Unlocked
    expect(sim.featureRegistry.isUnlocked('MOVE_ROLL')).toBe(true);

    // D: Design
    const bp = sim.designManager.createBlueprint('central', {
      features: [
        { featureId: 'MOVE_ROLL', allocation01: 0.5 },
        { featureId: 'OPTICAL_VISION', allocation01: 0.5 }
      ]
    });

    // P: Produce
    const prodJob = sim.productionManager.queueBuild('central', bp.typeId);
    while (prodJob.status !== 'DONE') sim.step();

    // U: Unit exists
    const units = sim.getUnitsByType(bp.typeId);
    expect(units.length).toBe(1);
  });
});
```

---

## 5. Performance Tests

### 5.1 Tick Time Benchmark

```javascript
describe('Performance', () => {
  test('tick < 8ms with 50 units', () => {
    const sim = createTestSim();

    for (let i = 0; i < 50; i++) {
      sim.spawnUnit({ position: [i * 10, 0, 0] });
    }

    const times = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      sim.step();
      times.push(performance.now() - start);
    }

    const p95 = times.sort((a,b) => a-b)[Math.floor(times.length * 0.95)];
    expect(p95).toBeLessThan(8);
  });

  test('serialization < 50ms with 100 entities', () => {
    const sim = createTestSim();
    for (let i = 0; i < 100; i++) {
      sim.spawnUnit({ position: [i * 10, 0, 0] });
    }

    const start = performance.now();
    const serialized = sim.serialize();
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(50);
    expect(JSON.stringify(serialized).length).toBeLessThan(100000);
  });
});
```

### 5.2 Memory Profiling

```javascript
// tests/memory-profile.js
global.gc();
const initialMemory = process.memoryUsage().heapUsed;

const sim = new SimCore({ seed: 42 });

// 10 minutes gameplay
for (let i = 0; i < 12000; i++) {
  sim.step();
  if (i % 1000 === 0) {
    global.gc();
    const mem = (process.memoryUsage().heapUsed - initialMemory) / 1024 / 1024;
    console.log(`Tick ${i}: ${mem.toFixed(2)} MB`);
  }
}

global.gc();
const finalMemory = (process.memoryUsage().heapUsed - initialMemory) / 1024 / 1024;

if (finalMemory > 50) {
  console.error('MEMORY LEAK SUSPECTED');
  process.exit(1);
}
```

---

## 6. Smoke Test Checklists

### 6.1 Quick Smoke (Every Commit)

- [ ] `npm start` runs without errors
- [ ] Game loads at localhost:8081
- [ ] Can select unit
- [ ] Can issue move command
- [ ] Unit moves to destination
- [ ] No console errors

### 6.2 Full Smoke (Every Release)

- [ ] All Quick Smoke items
- [ ] Camera: pan, orbit, zoom
- [ ] Camera: fly-to animation
- [ ] Direct Control: keyboard moves unit
- [ ] Path: can draw waypoints
- [ ] FOW: unexplored areas dark
- [ ] FOW: visible areas bright
- [ ] Multi-unit: can select multiple
- [ ] Multi-unit: all respond to commands
- [ ] Performance: 60 FPS with 10 units

### 6.3 Multiplayer Smoke

- [ ] Create lobby
- [ ] Join lobby from second browser
- [ ] Host issues command, client sees result
- [ ] Client issues command, host processes
- [ ] 5 minutes without desync
- [ ] Late join receives correct state

---

## 7. CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - run: npm ci

      # Hard gates (must pass)
      - run: npm test
      - run: npm run test:determinism

      # Soft targets (measure + report)
      - run: npm run test:coverage
        continue-on-error: true

      - run: npm run perf:measure
        continue-on-error: true

      # Upload reports
      - uses: codecov/codecov-action@v3
```

---

## 8. CI Gates

| Gate | Type | Threshold | Action on Fail |
|------|------|-----------|----------------|
| Unit tests pass | Hard | 100% | Block merge |
| Determinism test | Hard | Pass | Block merge |
| MP sync smoke | Hard | Pass | Block merge |
| Coverage | Soft | > 75% | Report only |
| Tick time p95 | Soft | < 8ms | Report only |

---

*End of Appendix G*