# Multiplayer Target Choice: Host-Authoritative (Gateway to Server)

## 1. Recommended Model: Host-Authoritative
We should target a **Host-Authoritative** model where one player's client acts as the "Server" (Listen Server), but code is written as if the Server is remote.

### Why?
*   **Simplest Transition:** You don't need a dedicated headless Node.js backend *yet*.
*   **Immediate Testing:** Launch two tabs. One is Host, one is Client.
*   **Future Proof:** If the "Host" logic is isolated in `SimCore`, moving it to a real Server is copy-paste.

## 2. Architecture Layers

### A. The "Sim" (Logic)
*   Runs Fixed Tick (e.g., 10 or 20 Hz).
*   Processes `InputQueue` -> Updates `State`.
*   Output: `StateSnapshot` (for visuals).

### B. The "Relay" (Transport)
*   **MVP (Local):** `BroadcastChannel` (Tab-to-Tab communication).
*   **Prod (P2P):** WebRTC (PeerJS).
*   **Prod (Server):** WebSocket / Supabase Realtime.

### C. The "View" (Render)
*   Interpolates between two Snapshots.
*   Never touches `State` directly.
*   Sends Inputs to "Relay".

## 3. Data Flow Strategy
1.  **Input:** Client clicks "Move" -> Generates `Command` -> Sends to Host.
2.  **Process:** Host receives `Command` -> Adds to Sim Queue -> Sim Executes.
3.  **Sync:** Host broadcasts `StateSnapshot` (or Input History for Deterministic Lockstep) to all Clients.
4.  **Render:** Clients receive data -> Update local "Ghost" state -> Interpolate visuals.

## 4. Minimal Backend Requirements (Phase 1)
For early tests, **NO BACKEND** is required (use LocalHost / P2P).
For MVP Release:
*   **Auth:** Supabase Auth (Identify users).
*   **Lobby/Signaling:** Supabase Database (Find matches, exchange WebRTC offers).
*   **Game Data:** P2P (Direct transfer).

## 5. Decision
**Target:** **Lockstep-ready Host-Authoritative**.
*   **Logic:** Deterministic command processing (SimCore).
*   **Network:** Abstracted (start with Local Loopback).
