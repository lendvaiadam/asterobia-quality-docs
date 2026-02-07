# Supabase Schema: game_unit_history

## Overview

This table tracks ownership changes for units during multiplayer sessions.
Used for audit logging, analytics, and potential rollback scenarios.

**Module**: R013 Multiplayer
**Milestone**: M07 Unit Authority
**Status**: Schema Draft (not yet deployed)

## Table Schema

```sql
CREATE TABLE game_unit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid,
  unit_id int4,
  tick int8,
  prev_owner int,
  new_owner int,
  event_type text,
  created_at timestamptz DEFAULT now()
);

-- Index for session-based queries
CREATE INDEX idx_game_unit_history_session ON game_unit_history(session_id);

-- Index for unit-based queries
CREATE INDEX idx_game_unit_history_unit ON game_unit_history(unit_id);

-- Index for chronological queries within session
CREATE INDEX idx_game_unit_history_session_tick ON game_unit_history(session_id, tick);
```

## Column Descriptions

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key, auto-generated |
| `session_id` | uuid | Foreign key to multiplayer session |
| `unit_id` | int4 | The unit whose ownership changed |
| `tick` | int8 | Simulation tick when change occurred |
| `prev_owner` | int | Previous owner slot (null for spawn) |
| `new_owner` | int | New owner slot (null for destroy) |
| `event_type` | text | Type of ownership event (see below) |
| `created_at` | timestamptz | Server timestamp of record creation |

## Event Types

| Event Type | Description |
|------------|-------------|
| `SPAWN` | Unit created, initial owner assigned |
| `TRANSFER` | Ownership transferred between players |
| `CAPTURE` | Unit captured by enemy player |
| `RELEASE` | Player voluntarily released control |
| `DESTROY` | Unit destroyed, ownership cleared |
| `SEAT_ACQUIRE` | Controller seat acquired (M07) |
| `SEAT_RELEASE` | Controller seat released (M07) |

## Row-Level Security (RLS)

```sql
-- Enable RLS
ALTER TABLE game_unit_history ENABLE ROW LEVEL SECURITY;

-- Policy: Session participants can read their session history
CREATE POLICY "Session participants can read history"
  ON game_unit_history
  FOR SELECT
  USING (
    session_id IN (
      SELECT session_id FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Only host can insert history records
CREATE POLICY "Host can insert history"
  ON game_unit_history
  FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT id FROM game_sessions
      WHERE host_user_id = auth.uid()
    )
  );
```

## Usage Notes

1. **Host-Only Writes**: Only the Host client writes to this table to maintain authority.

2. **Tick Synchronization**: The `tick` column uses the authoritative sim tick from Host.

3. **Privacy**: This table does NOT store sensitive data like `seatPinDigit`.

4. **Retention**: Consider implementing a retention policy for old session data.

## Related Tables

- `game_sessions`: Parent session metadata
- `session_participants`: Player-session associations
- `game_snapshots`: Full state snapshots for resync

## Migration Notes

This table is part of R013 M07 and should be created alongside the multiplayer feature deployment.

---
*Last Updated: 2026-02-07*
*Milestone: R013-M07 Unit Authority*
