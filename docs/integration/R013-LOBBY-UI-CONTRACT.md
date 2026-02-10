# R013 Lobby UI Integration Contract

**Version**: 0.13.0
**Status**: Draft
**Owner**: Frontend
**Consumers**: UI Components (M14)

---

## 1. Overview

This contract defines the interface between SessionManager (Backend) and Lobby UI (Frontend) for R013 multiplayer host discovery.

---

## 2. Entry Point

```javascript
game.sessionManager.startDiscovery()
```

**Trigger**: User navigates to "Find Game" screen
**Behavior**: Begins listening to lobby channel for HOST_ANNOUNCE messages
**Prerequisite**: SessionManager must be initialized

---

## 3. Exit Point

```javascript
game.sessionManager.stopDiscovery()
```

**Trigger**: User leaves "Find Game" screen (back navigation, join, or close)
**Behavior**: Stops listening to lobby channel, clears internal host cache
**Requirement**: MUST be called on screen leave to prevent resource leaks

---

## 4. Polling Interface

```javascript
const hosts = game.sessionManager.getAvailableHosts()
```

**Returns**: `Array<HostEntry>`
**Frequency**: Poll at 2-4Hz maximum (250-500ms intervals)
**Constraint**: NEVER call per-frame (60Hz) — this is a cache read, not a network call

---

## 5. HostEntry Shape

```typescript
interface HostEntry {
  hostId: string;        // UUID of host client
  sessionName: string;   // Display name (e.g., "Adam's Game")
  playerCount: number;   // Current players in session
  maxPlayers: number;    // Session capacity
  mapSeed: string;       // Map seed for preview
  lastSeenAt: number;    // Unix timestamp of last announce
}
```

**Staleness Rule**: UI should dim/remove entries where `Date.now() - lastSeenAt > 10000` (10s timeout)

---

## 6. Out-of-Scope

The following are NOT part of this contract and will be addressed in M14:

- UI component implementation (host list, refresh button, join button)
- Visual design and styling
- Loading/error states
- Join flow initiation

---

## 7. Sequence Diagram

```
┌─────────┐          ┌────────────────┐          ┌─────────────────┐
│ Lobby UI│          │ SessionManager │          │ SupabaseTransport│
└────┬────┘          └───────┬────────┘          └────────┬────────┘
     │                       │                            │
     │ startDiscovery()      │                            │
     │──────────────────────>│                            │
     │                       │ joinChannel('lobby')       │
     │                       │───────────────────────────>│
     │                       │                            │
     │                       │    HOST_ANNOUNCE events    │
     │                       │<───────────────────────────│
     │                       │                            │
     │ getAvailableHosts()   │                            │
     │──────────────────────>│                            │
     │   Array<HostEntry>    │                            │
     │<──────────────────────│                            │
     │                       │                            │
     │ stopDiscovery()       │                            │
     │──────────────────────>│                            │
     │                       │ leaveChannel('lobby')      │
     │                       │───────────────────────────>│
     └───────────────────────┴────────────────────────────┘
```

---

## 8. Dependencies

- **M03**: SessionManager skeleton (COMPLETED)
- **M04**: Host lobby channel + announce (IN PROGRESS)
- **M05**: Guest discovery implementation (PENDING)
