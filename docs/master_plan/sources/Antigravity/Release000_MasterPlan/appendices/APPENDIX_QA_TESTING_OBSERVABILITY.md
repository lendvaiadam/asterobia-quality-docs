# APPENDIX F: QA, TESTING & OBSERVABILITY (v3)

**Parent Document:** [Big Picture Master Plan v3](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** Automated testing framework, manual verification protocols, and performance budgets.

---

## 1. Automated Testing (Jest)

We focus on **Logic Verification**. We do NOT test Three.js rendering in Jest.

### 1.1 "SimCore" Unit Tests

```javascript
// tests/sim/SimCore.test.js
describe('SimCore Determinism', () => {
    let sim;
    
    beforeEach(() => {
        sim = new SimCore({ seed: 12345 });
    });

    test('should produce identical state sequence given identical inputs', () => {
        const simA = new SimCore({ seed: 111 });
        const simB = new SimCore({ seed: 111 });
        
        const cmd = { type: 'MOVE', tick: 10, payload: { x: 50, z: 50 } };
        
        // Advance 100 ticks
        for(let i=0; i<100; i++) {
            if (i === 10) {
                simA.input(cmd);
                simB.input(cmd);
            }
            simA.tick();
            simB.tick();
        }
        
        expect(JSON.stringify(simA.state)).toEqual(JSON.stringify(simB.state));
    });
});
```

### 1.2 Networking Tests (Mock)

```javascript
describe('Transport', () => {
    test('local loopback delivers commands', (done) => {
        const transport = new LocalTransport();
        transport.onCmdReceived((cmd) => {
            expect(cmd.type).toBe('TEST');
            done();
        });
        transport.sendCmd({ type: 'TEST' });
    });
});
```

---

## 2. Manual Verification ("Smoke Test")

**Protocol:** Execute before *every* PR merge.

| Step | Action | Expected Result |
| :--- | :--- | :--- |
| 1 | `npm start` | App loads, no console errors. |
| 2 | Click "Host Game" (Tab 1) | Lobby Created, PeerID displayed. |
| 3 | Copy PeerID -> Open Tab 2 | "Join Game" success. |
| 4 | Tab 1: Select Unit, Move Right | Unit moves on *both* screens. |
| 5 | Tab 2: Disconnect Network | Game pauses / "Reconnecting" UI appears. |

---

## 3. Performance & Budget

### 3.1 Strict Limit: 8ms Tick
The `SimCore.step()` MUST complete in < 8ms on average (M1 Macbook Air baseline).
*   **Monitor:** `State.meta.lastTickDuration` exposed in Debug Overlay.
*   **Fail Action:** If > 8ms, we must optimize (Spatial Partitioning, Object Pools).

### 3.2 Memory Budget
*   **Entities:** Max 500 active.
*   **Snapshots:** Max 100KB JSON size. (If larger, Delta compression required).

---

## 4. Debug Overlay (The "God Mode")

We need a Runtime Developer UI (`dat.gui` or HTML overlay).

**Required Data Points:**
*   `Tick`: 12054
*   `Sim Time`: 8.43ms (Avg)
*   `Ping`: 45ms
*   `Cmd Queue`: 0
*   `Entity Count`: 42
*   **Visual Debug Toggle:**
    *   [x] Show Hitboxes
    *   [x] Show Vision Rays
    *   [x] Show Pathfinding grid

---
*End of Appendix*
