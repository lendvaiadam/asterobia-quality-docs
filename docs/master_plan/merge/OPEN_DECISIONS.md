# OPEN DECISIONS: Release 000 Merge

**Date:** 2026-01-22
**Status:** REQUIRED for Master Plan Authorization

## 1. UI Tech Stack

**Context:** The "Designer" (D) and "Research" (R) phases require complex UI overlays (Blueprint editor, Tech tree).
**Current State:** Vanilla JS + Three.js.
**Missing:** A standard for building complex UI (not just debug panels).

| Option | Pros | Cons | Recommendation |
|:-------|:-----|:-----|:---------------|
| **A: Vanilla DOM + CSS** | Zero deps, fast init, native. | Hard to manage complex state (Blueprint trees). | **Reject** for complex UI. |
| **B: React / Preact** | Standard for generic web UI, declarative. | Build step complexity, "React in Game" friction. | **Consider** (Preact via CDN?). |
| **C: Canvas / GUI Lib (Leva/Tweakpane)** | Integrated with renderer, no DOM overlay lag. | Limited styling, bad for text/tables. | **Reject** for main Gameplay UI. |
| **D: Web Components (Lit)** | Native-ish, encapsulated, modern. | Learning curve, minor boilerplate. | **Strong Candidate**. |

**Decision Trigger:** Ádám to choose preference.
**Recommended Default:** **Vanilla Custom Elements (Web Components)**. Keep it standard, no framework bloat, but structured.

---

## 2. Snapshot Strategy (Bandwidth vs Simplicity)

**Context:** How game state is sent from Host to Client.
**Conflict:**
*   **Claude:** Suggests "Delta Compression" (diffs) for Release 002+.
*   **Antigravity:** Suggests "Full Snapshots" for Phase 0/1 simplicity.

| Option | Pros | Cons | Recommendation |
|:-------|:-----|:-----|:---------------|
| **A: Full Snapshots (v1)** | Extreme simplicity (JSON.stringify). Zero drift risk from missed deltas. | High bandwidth (10-50KB/tick). Doesn't scale to 100s of units. | **ACCEPT for Phase 0/1**. |
| **B: Delta Compression** | Low bandwidth. Professional standard. | Complex to implement (diff logic). Risk of state desync if packet loss + buffer overflow. | **Defer to Phase 2**. |

**Decision:** **Option A (Full Snapshots)** explicitly for Releases 000-020.
**Rationale:** Premature optimization is the root of all evil. We need *correctness* (Netcode Readiness) first.

---

## 3. Replay System Spec

**Context:** Missing from both plans.
**Proposal:**
*   **Input Recorder:** Host records `[Tick, PlayerID, CommandStruct]`.
*   **Replay File:** JSON Array of Commands + Initial Seed.
*   **Playback:** SimCore initialized with Seed, fed Commands at correct ticks. No network needed.

**Decision:** Add "Replay verification" to Release 009 (Full Determinism Verification). It is the ultimate test of determinism.
