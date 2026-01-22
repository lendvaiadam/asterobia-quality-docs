# ASTEROBIA — BIG PICTURE MASTER DEVELOPMENT PLAN (v3)

**Date:** 2026-01-21
**Status:** **READY FOR EXECUTION (Deep Implementation Edition)**
**Author:** Antigravity (Gemini)
**Target Branch:** `work/release-000-big-picture-antigravity-v2`
**Scope:** End-to-End Implementation (Netcode, Backend, Features, Multiplayer)

---

## 1. Executive Summary: The Vision

Asterobia is not just an RTS; it is a **simulation-first** competitive strategy game built on a rigid **Host-Authoritative, Lockstep-Ready** architecture.

This **Master Plan v3** is the "Engineering Bible". It moves beyond high-level descriptions to provide **Code-Level Specifications** for the `SimCore`, `Transport`, `Backend`, and `Feature` pipelines.

### 1.1 "Done Means" Definition

The project is **Done** only when:
*   **Architecture:** The `SimCore` runs in a dedicated loop (20Hz), fully decoupled from Three.js (60Hz+), utilizing an interface-based `ITransport` layer.
*   **Networking:** Two browser tabs can connect via P2P (PeerJS), with one acting as Authoritative Host, and the other receiving Snapshots/Deltas with 0% logic drift.
*   **Gameplay:** A player can Design a unit (Blueprints), Manufacture it (Production), Move it (Rolling Physics), Mine resources (Matera), and Destroy an enemy, with all state changes persisting correctly.
*   **Production:** The manufacturing pipeline (Design D -> Production P) works end-to-end, including Generative AI asset binding (Nano Banana -> Trellis -> GLB).

---

## 2. Table of Contents & Implementation Appendices

**MANDATORY READING:** The bulk of the implementation detail (approx. 200KB of text/code) is contained in these appendices.

*   **[Appendix A: Multiplayer & Internet Stack](./appendices/APPENDIX_MULTIPLAYER_INTERNET_STACK.md)**
    *   *Includes:* `SimLoop` class, `StateRegistry` interface, `CommandFactory` logic, `WebRTCTransport` implementation, `Mulberry32` RNG.
*   **[Appendix B: Backend & Persistence Schema](./appendices/APPENDIX_BACKEND_PERSISTENCE_SCHEMA.md)**
    *   *Includes:* Full SQL Schema (`profiles`, `lobbies`, `blueprints`), RLS Policies, Storage Buckets, and JSON Data Structures.
*   **[Appendix C: GRFDTRDPU & Feature Implementation](./appendices/APPENDIX_GRFDTRDPU_RD_DEV_PROD_IMPLEMENTATION.md)**
    *   *Includes:* `GoalEvaluator`, `ResearchManager`, `Factory` queue logic, and specific Physics/Combat/Mining algorithms for the 7 Canonical Features.
*   **[Appendix D: Feature Dependency Graph](./appendices/APPENDIX_FEATURE_DEPENDENCY_GRAPH.md)**
    *   *Includes:* Critical Path Analysis, Subsystem Mermaid graphs, Module Interaction Matrix.
*   **[Appendix E: Releases, Sprints & PR Plan](./appendices/APPENDIX_RELEASES_SPRINTS_PR_PLAN.md)**
    *   *Includes:* Phase 0 & 1 Work Breakdown Structure with Test Criteria per PR.
*   **[Appendix F: QA, Testing & Observability](./appendices/APPENDIX_QA_TESTING_OBSERVABILITY.md)**
    *   *Includes:* Jest unit test examples for Determinism, Smoke Test Protocol, Performance Budgets.
*   **[Appendix G: Risk Register](./appendices/APPENDIX_RISK_REGISTER.md)**
    *   *Includes:* Code mitigations for "Spiral of Death" (Lag), Determinism Drift, and Asset Failure.
*   **[Appendix H: Gap Analysis Report](./appendices/GAP_ANALYSIS_REPORT.md)**
    *   *Includes:* The original 22 binding constraints from strict audit.

---

## 3. Architecture Stratification (The Stack)

The system is built in **Layers**. Higher layers depend on lower layers. Lower layers **never** know about higher layers.

### Layer 0: The Platform (Browser/OS)
*   **Constraints:** JS Single Thread, Memory limits, Network NAT.

### Layer 1: The SimCore (Kernel)
*   **Responsibility:** The Truth.
*   **Tick Rate:** 20Hz (Hard Fixed).
*   **Inputs:** `CommandQueue` (NOT keyboard/mouse).
*   **Outputs:** `SimState` Snapshot.
*   **Dependencies:** None (Pure JS/TS). No Three.js code here.

### Layer 2: The Transport (Network)
*   **Responsibility:** Moving Data.
*   **Components:** `ITransport`, `LocalLoopback`, `WebRTCTransport`.
*   **Role:** Replicates CommandQueue to Host; Replicates State to Clients.

### Layer 3: The View (Presenter)
*   **Responsibility:** Visualization & Prediction.
*   **Components:** Three.js, ECS (Visuals), InputHandlers.
*   **Role:** Renders `State` + `Alpha` (Interpolation). Sends User Input to `CommandFactory`.

### Layer 4: The Services (Cloud)
*   **Responsibility:** Persistence & Discovery.
*   **Components:** Supabase (Auth, DB, Realtime), GenAI APIs (Image/3D).

---

## 4. Multiplayer Endgame Strategy

**Goal:** Seamless P2P Multiplayer (Host-Auth).

### 4.1 The Roadmap
1.  **Step 1: Local Loopback (Release 006)**
    *   Host and Client run in same browser memory. `ITransport` just copies arrays.
    *   *Validates:* Authority logic, State serialization.
2.  **Step 2: Local Network (LAN)**
    *   Use direct WebRTC IP or internal signaling.
    *   *Validates:* Latency handling, Interpolation smoothing.
3.  **Step 3: Internet (Wan)**
    *   Use Supabase for Signaling + STUN/TURN (PeerJS).
    *   *Validates:* NAT Traversal, Packet Loss handling.

### 4.2 Why Host-Authoritative?
*   **Cost:** No expensive headless servers to rent.
*   **Latency:** Host gets 0ms latency (feels crisp).
*   **Complexity:** Easier than full Lockstep (RTS) or Client-Side Prediction (FPS). Input is sent to Host; Host decides; Host sends State back.

---

## 5. R&D Pipeline (GRFDTRDPU) Integration

We do not just "build units". We **Research** capabilities, **Design** blueprints, and **Produce** instances.

### 5.1 The Data Flow
1.  **Research (R):** Unlocks `Feature: MOVE_ROLL`.
2.  **Design (D):** Player opens Designer. Selects `MOVE_ROLL` (50% Cap) + `MINING` (50% Cap).
    *   System generates Prompt -> Nano Banana (Image) -> Trellis (GLB).
    *   Result: `UnitBlueprint` ("DrillBug v1").
3.  **Production (P):** Factory queue consumes Resources.
    *   Result: `UnitEntity` (Instance ID 105).
4.  **Usage (F):** Unit 105 runs `MOVE_ROLL` logic in SimCore.

---

## 6. Open Decisions & Logic
*See individual Appendices for detailed resolution strategies.*

1.  **Physics Engine:** Custom Spherical Physics (Status: **Keep Custom**).
2.  **Matera Voxelization:** Variable Grid (Status: **Plan Phase 2**).
3.  **Generative Assets:** Nano Banana + Trellis (Status: **Confirmed**).

---
*Verified Compliance: All Read Gate sources checked. All required Appendices created and expanded with deep logic.*
