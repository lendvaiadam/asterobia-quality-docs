# SKILL: Supabase Realtime

**ID**: `skill-supabase-realtime`
**Role**: Backend / Multiplayer
**Status**: ACTIVE

---

## 1. Purpose
Implement and manage Supabase Realtime channels for multiplayer features, including lobby state, session data exchange, and presence tracking.

## 2. Scope
- Channel operations: `join`, `leave`, `subscribe`.
- Broadcast messaging: `broadcastToChannel`.
- Presence tracking: `track`, `onSync`.
- PostgreSQL Change Data Capture (CDC) subscriptions.

## 3. Hard Constraints (MUST NOT)
- **NO RLS Modification**: Do not modify RLS policies directly in channel code.
- **NO Service Role**: Do not use `service_role` key for channel operations.
- **NO Bypass**: Must NOT bypass `ITransport` abstraction. All logical messages must flow through the standardized transport layer.

## 4. Triggers (When to Use)
- Implementing Lobby Discovery (M04-M05).
- Implementing Session Channel messaging (M06+).
- Adding specialized broadcast features (e.g. detailed room events).

## 5. Checklist
- [ ] Channel name follows namespace convention (`asterobia:namespace:id`).
- [ ] `.subscribe()` includes error handling for `CHANNEL_ERROR`.
- [ ] Cleanup logic exists (e.g., `removeChannel` on component unmount/disconnect).
- [ ] Message payload size is optimized (avoid sending massive objects if unnecessary).

## 6. Usage Examples

### A. Joining a Public Lobby Channel
```javascript
transport.joinChannel('asterobia:lobby', (msg) => {
  if (msg.type === 'HOST_ANNOUNCE') {
    // Handle host announcement
  }
});
```

### B. Broadcasting an Announce
```javascript
const payload = {
  type: 'HOST_ANNOUNCE',
  hostId: 'uid-123',
  mapSeed: 42
};
transport.broadcastToChannel('asterobia:lobby', payload);
```

## 7. Out of Scope
- Durable database storage (Use `skill-supabase-schema`).
- Auth token management (Use `skill-supabase-auth`).
