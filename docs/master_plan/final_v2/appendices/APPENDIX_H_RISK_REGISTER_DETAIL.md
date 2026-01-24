# APPENDIX H: RISK REGISTER DETAIL

**Parent Document:** [MASTER_PLAN_FINAL_v2.md](../MASTER_PLAN_FINAL_v2.md)
**Scope:** Detailed risk analysis, mitigations, triggers, contingencies

---

## Risk Matrix

| Probability / Impact | Low | Medium | High | Critical |
|---------------------|-----|--------|------|----------|
| **High** | Monitor | Mitigate | Mitigate | Avoid |
| **Medium** | Accept | Monitor | Mitigate | Mitigate |
| **Low** | Accept | Accept | Monitor | Mitigate |

---

## R1: Performance Ceiling

| Attribute | Value |
|-----------|-------|
| **ID** | RISK-001 |
| **Category** | Technical |
| **Probability** | Medium (40%) |
| **Impact** | High |
| **Status** | Active |

### Description
JavaScript single-threaded nature may cause frame drops when SimCore.step() exceeds tick budget (10ms at 20Hz leaves only 50% headroom).

### Triggers
- Unit count > 50
- Complex pathfinding (> 10 concurrent requests)
- Large state serialization (> 50KB)
- Physics calculations on complex terrain

### Indicators
| Level | Condition | Action |
|-------|-----------|--------|
| Warning | Tick time p95 > 5ms | Log, monitor trend |
| Critical | Tick time p95 > 8ms | Alert, investigate |
| Emergency | Tick time p95 > 15ms | Enable degraded mode |

### Mitigations

**Immediate (Phase 0):**
```javascript
// Spiral of death prevention
if (stepsThisFrame > 5) {
  this.accumulator = 0;
  console.warn('GameLoop: Dropped frames');
  break;
}
```

**Short-term (Phase 1):**
- Move SimCore to Web Worker
- Implement time budget per system
- Profile and optimize hot paths

**Long-term (Post-Demo):**
- WASM for physics calculations
- Spatial partitioning for collision
- LOD for distant entities

### Contingency
If mitigations insufficient:
- Reduce unit cap to 30
- Simplify pathfinding (grid-based)
- Increase tick interval to 15Hz
- Enable "performance mode" toggle

---

## R2: Determinism Drift

| Attribute | Value |
|-----------|-------|
| **ID** | RISK-002 |
| **Category** | Technical |
| **Probability** | High (60%) |
| **Impact** | Critical |
| **Status** | Active |

### Description
Floating-point variance between browsers/CPUs causes state divergence in multiplayer.

### Triggers
- Extended gameplay sessions (> 30 minutes)
- Complex physics calculations
- Different CPU architectures (Intel vs AMD vs ARM)
- Different browsers (Chrome vs Firefox vs Safari)

### Indicators
| Level | Condition |
|-------|-----------|
| Warning | State hash mismatch within 5 minutes |
| Critical | Desync rate > 1 per minute |
| Emergency | Persistent desync after resync |

### Mitigations

**Immediate:**
```javascript
// Hash check every 60 ticks
if (tick % 60 === 0) {
  broadcast({ type: 'HASH_CHECK', hash: getStateHash() });
}
```

**Short-term:**
- Auto-resync on mismatch
- Detailed diff logging for debugging
- Avoid problematic operations (sqrt, trig accumulation)

**Long-term:**
- Fixed-point math library
- Deterministic math polyfill
- WASM for critical calculations

### Contingency
If determinism cannot be guaranteed:
- Full state sync every 5 seconds
- Server-authoritative mode (increased latency)
- Disable multiplayer for affected browser combinations

---

## R3: Unit.js Monolith

| Attribute | Value |
|-----------|-------|
| **ID** | RISK-003 |
| **Category** | Technical Debt |
| **Probability** | High (70%) |
| **Impact** | Medium |
| **Status** | Active |

### Description
Tightly coupled Unit.js (~1500 lines) makes state extraction risky.

### Triggers
- Any modification to Unit.js
- State extraction attempts
- Feature additions

### Indicators
- Smoke test failures after Unit.js changes
- Unexpected behavior changes
- Direct Control regression

### Mitigations

**Approach:** Shim-based extraction (per Human Owner Q16)

```javascript
// Don't delete Unit.js code, wrap it
class UnitShim {
  constructor(simCoreState, threeJsObject) {
    this.state = simCoreState;  // Authoritative
    this.mesh = threeJsObject;  // Render only
  }

  update(dt, alpha) {
    // Interpolate render position from state
    this.mesh.position.lerpVectors(
      this.state.prevPosition,
      this.state.position,
      alpha
    );
  }
}
```

**Rules:**
- Never modify Unit.js without full smoke test
- Extract state incrementally (position first, then features)
- Keep backward compatibility during transition
- Document all dependencies

### Contingency
If extraction fails:
- Revert immediately
- Pair programming for Unit.js changes
- Consider parallel rewrite with feature flag

---

## R4: WebRTC NAT Traversal

| Attribute | Value |
|-----------|-------|
| **ID** | RISK-004 |
| **Category** | Network |
| **Probability** | Medium (30%) |
| **Impact** | Medium |
| **Status** | Active |

### Description
Symmetric NAT and firewall configurations prevent P2P connection.

### Triggers
- Corporate networks
- Strict router configurations (symmetric NAT)
- Mobile carriers (CGNAT)
- University networks

### Indicators
| Level | Condition |
|-------|-----------|
| Warning | ICE gathering > 5 seconds |
| Critical | Connection timeout > 15 seconds |
| Fallback | TURN usage > 30% of connections |

### Mitigations

**Immediate:**
- Multiple STUN servers
- Connection timeout with retry

**Short-term (per Q11):**
- TURN server deployment
- TURN credential management

**Future:**
- WebSocket fallback option
- Connection quality indicator in UI

### TURN Configuration

```javascript
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:turn.asterobia.com:3478',
      username: 'asterobia',
      credential: process.env.TURN_SECRET
    }
  ],
  iceTransportPolicy: 'all' // Try direct first, fallback to relay
};
```

### Contingency
- TURN for all connections (higher latency acceptable)
- Display "connection quality" indicator
- Suggest network troubleshooting tips

---

## R5: Supabase Limits

| Attribute | Value |
|-----------|-------|
| **ID** | RISK-005 |
| **Category** | Infrastructure |
| **Probability** | Low (20%) |
| **Impact** | Medium |
| **Status** | Monitoring |

### Description
Supabase tier limits could impact functionality.

### Triggers
- Rapid user growth
- Large game saves
- High Realtime connection count

### Limits (Pro Tier)

| Resource | Limit | Current Est. Usage |
|----------|-------|-------------------|
| Database | 8GB | < 100MB |
| Storage | 100GB | < 1GB |
| Realtime | 500 concurrent | < 50 |
| API requests | 500K/month | < 50K |

### Mitigations

**Implemented:**
- Snapshot compression
- Autosave cleanup (7 days)
- Connection pooling

**Planned:**
- Usage monitoring dashboard
- Alert at 80% threshold
- Archive old data

### Contingency
- Delete old autosaves automatically
- Reduce snapshot frequency
- Queue lobby joins during peak

---

## R6: Scope Creep

| Attribute | Value |
|-----------|-------|
| **ID** | RISK-006 |
| **Category** | Project |
| **Probability** | Medium (50%) |
| **Impact** | High |
| **Status** | Active |

### Description
Feature additions beyond Demo 1.0 scope delay release.

### Triggers
- "One more feature" requests
- Perfectionism on non-critical systems
- Unclear done criteria

### Indicators
- Work on non-Demo features
- Scope discussions without resolution
- Delayed milestones

### Mitigations

**Binding scope definition:**
Demo 1.0 Done Means (from main document):
1. Single-player core loop works
2. Deterministic + replay
3. 2-4 player multiplayer
4. Save/Load
5. 6 required features + 2 stretch
6. CI baseline gates

**Rules:**
- Any feature not listed is POST-DEMO
- Stretch features can be cut if timeline slips
- New requests go to backlog, not current sprint

### Contingency
If behind schedule:
- Cut stretch features (TERRAIN_SHAPING, UNIT_CARRIER)
- Simplify UI (basic controls only)
- Reduce multiplayer to 2-player only

---

## Risk Monitoring Schedule

| Risk | Check Frequency | Owner |
|------|-----------------|-------|
| R1 Performance | Every PR (CI) | Dev |
| R2 Determinism | Every PR (CI) | Dev |
| R3 Unit.js | Every Unit.js change | Dev |
| R4 WebRTC | Weekly test session | Dev |
| R5 Supabase | Monthly usage review | Lead |
| R6 Scope | Sprint planning | Lead |

---

*End of Appendix H*