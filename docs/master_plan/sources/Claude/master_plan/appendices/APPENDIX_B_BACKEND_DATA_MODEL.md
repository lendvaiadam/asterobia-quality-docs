# APPENDIX B: BACKEND DATA MODEL

**Parent Document:** [Master Development Plan v1 (Claude)](../MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md)
**Scope:** Supabase schema, persistence strategy, data contracts, migration plan

---

## 1. Supabase Architecture Overview

### 1.1 Services Used

| Service | Purpose | Phase |
|---------|---------|-------|
| **Auth** | Player identity, sessions | Phase 2 |
| **Database** | Persistent storage (PostgreSQL) | Phase 2 |
| **Realtime** | Live updates, signaling | Phase 2 |
| **Storage** | Blueprint thumbnails, replays (future) | Phase 3 |

### 1.2 Database Schema Diagram

```
+----------------+       +------------------+       +---------------+
|   auth.users   |       |    profiles      |       |   blueprints  |
+----------------+       +------------------+       +---------------+
| id (pk)        |<----->| id (pk, fk)      |<----->| id (pk)       |
| email          |       | display_name     |       | owner_id (fk) |
| created_at     |       | avatar_url       |       | name          |
+----------------+       | created_at       |       | version       |
                         +------------------+       | data (jsonb)  |
                                                    | is_public     |
                                                    +---------------+
                                                           ^
                                                           |
+------------------+                              +------------------+
|     lobbies      |                              | blueprint_licenses|
+------------------+                              +------------------+
| id (pk)          |                              | id (pk)          |
| host_id (fk)     |                              | blueprint_id(fk) |
| host_peer_id     |                              | licensee_id (fk) |
| name             |                              | granted_at       |
| status           |                              +------------------+
| max_players      |
| players (jsonb)  |
| host_offer       |
| created_at       |
+------------------+
```

---

## 2. Table Definitions

### 2.1 Profiles Table

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Anonymous',
  avatar_url TEXT,
  stats JSONB DEFAULT '{}',
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_profiles_display_name ON profiles(display_name);

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Links to auth.users |
| `display_name` | TEXT | Shown in lobbies and game |
| `avatar_url` | TEXT | Profile picture URL |
| `stats` | JSONB | Games played, wins, etc. |
| `preferences` | JSONB | UI settings, keybindings |

### 2.2 Blueprints Table

```sql
CREATE TABLE blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 10,
  data JSONB NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_blueprint_version UNIQUE(owner_id, name, version)
);

-- Indexes
CREATE INDEX idx_blueprints_owner ON blueprints(owner_id);
CREATE INDEX idx_blueprints_public ON blueprints(is_public) WHERE is_public = true;
CREATE INDEX idx_blueprints_name ON blueprints(name);

-- Row Level Security
ALTER TABLE blueprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own blueprints"
  ON blueprints FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can view public blueprints"
  ON blueprints FOR SELECT
  USING (is_public = true);

CREATE POLICY "Users can insert own blueprints"
  ON blueprints FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own blueprints"
  ON blueprints FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own blueprints"
  ON blueprints FOR DELETE
  USING (auth.uid() = owner_id);
```

**Blueprint Data Schema (JSONB):**

```json
{
  "schemaVersion": "1.0.0",
  "features": {
    "MOVE_ROLL": {
      "allocation": 25,
      "axes": {}
    },
    "WPN_SHOOT": {
      "allocation": 25,
      "axes": {
        "power": 30,
        "rate": 20,
        "range": 30,
        "accuracy": 20
      }
    },
    "PERCEPTION_OPTICAL": {
      "allocation": 25,
      "axes": {}
    },
    "SYS_PRODUCTION": {
      "allocation": 25,
      "axes": {}
    }
  },
  "visualSeed": 12345,
  "modelUrl": "/assets/units/MORDIG10.glb"
}
```

### 2.3 Blueprint Licenses Table

```sql
CREATE TABLE blueprint_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
  licensee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_license UNIQUE(blueprint_id, licensee_id)
);

-- Row Level Security
ALTER TABLE blueprint_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own licenses"
  ON blueprint_licenses FOR SELECT
  USING (auth.uid() = licensee_id);

CREATE POLICY "Blueprint owners can grant licenses"
  ON blueprint_licenses FOR INSERT
  WITH CHECK (
    auth.uid() = (SELECT owner_id FROM blueprints WHERE id = blueprint_id)
  );
```

### 2.4 Lobbies Table

```sql
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  host_peer_id TEXT,
  name TEXT NOT NULL DEFAULT 'New Game',
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'STARTING', 'PLAYING', 'CLOSED')),
  max_players INTEGER NOT NULL DEFAULT 2 CHECK (max_players >= 2 AND max_players <= 8),
  players JSONB DEFAULT '[]',
  settings JSONB DEFAULT '{}',
  host_offer TEXT, -- SDP offer for WebRTC
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-cleanup old lobbies
CREATE INDEX idx_lobbies_created ON lobbies(created_at);
CREATE INDEX idx_lobbies_status ON lobbies(status);

-- Row Level Security
ALTER TABLE lobbies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view open lobbies"
  ON lobbies FOR SELECT
  USING (status = 'OPEN');

CREATE POLICY "Hosts can manage own lobbies"
  ON lobbies FOR ALL
  USING (auth.uid() = host_id);
```

**Lobby Players Schema (JSONB):**

```json
[
  {
    "id": "uuid",
    "displayName": "Player1",
    "ready": true,
    "team": 1
  },
  {
    "id": "uuid",
    "displayName": "Player2",
    "ready": false,
    "team": 2
  }
]
```

---

## 3. Data Contracts

### 3.1 Entity State Contract

```typescript
interface EntityState {
  id: string;
  type: 'UNIT' | 'MATERA_PILE' | 'DEPOSIT' | 'PROJECTILE';
  ownerId: string;
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion

  // Unit-specific
  unitData?: {
    typeId: string; // Blueprint reference
    hp: number;
    maxHp: number;
    energy: number;
    maxEnergy: number;
    cargo: number;
    maxCargo: number;
    commandQueueIndex: number;
    status: 'IDLE' | 'MOVING' | 'MINING' | 'COMBAT' | 'OFFLINE';
  };

  // Matera pile-specific
  pileData?: {
    amount: number;
    color: string;
  };

  // Deposit-specific
  depositData?: {
    totalAmount: number;
    remainingAmount: number;
    color: string;
    discovered: boolean;
  };
}
```

### 3.2 Command Contract

```typescript
type Command = MoveCommand | StopCommand | AttackCommand | MineCommand | ...;

interface BaseCommand {
  id: string;
  type: string;
  tick: number;
  playerId: string;
  unitIds: string[];
}

interface MoveCommand extends BaseCommand {
  type: 'MOVE';
  targetPosition: [number, number, number];
  waypoints?: [number, number, number][];
  formation?: 'NONE' | 'LINE' | 'COLUMN' | 'SPREAD';
}

interface StopCommand extends BaseCommand {
  type: 'STOP';
}

interface AttackCommand extends BaseCommand {
  type: 'ATTACK';
  targetId?: string;
  targetPosition?: [number, number, number];
}

interface MineCommand extends BaseCommand {
  type: 'MINE';
  depositId: string;
}

interface BuildCommand extends BaseCommand {
  type: 'BUILD';
  blueprintId: string;
  producerId: string;
}
```

### 3.3 Snapshot Contract

```typescript
interface GameSnapshot {
  version: string;
  tick: number;
  seed: number;
  nextId: number;

  entities: Record<string, EntityState>;

  terrain: {
    modifications: TerrainModification[];
  };

  players: Record<string, PlayerState>;

  research: Record<string, ResearchState>;

  explored: string; // Base64 encoded exploration grid
}

interface TerrainModification {
  position: [number, number];
  originalHeight: number;
  currentHeight: number;
}

interface PlayerState {
  id: string;
  resources: number;
  energy: number;
  maxEnergy: number;
  blueprintIds: string[];
}

interface ResearchState {
  featureId: string;
  status: 'LOCKED' | 'RESEARCHING' | 'UNLOCKED';
  progress: number;
  extendLevels: Record<string, number>;
}
```

---

## 4. Persistence Strategy

### 4.1 Local Storage (Autosave)

**Key Structure:**
```
asterobia_autosave_{slotIndex} -> Compressed JSON
asterobia_settings -> User preferences
asterobia_session -> Current session data
```

**Autosave Implementation:**

```javascript
// src/SimCore/persistence/LocalStorage.js
export class LocalStoragePersistence {
  constructor(slotCount = 3) {
    this.slotCount = slotCount;
    this.prefix = 'asterobia_';
  }

  save(snapshot, slot = 0) {
    const key = `${this.prefix}autosave_${slot}`;
    const compressed = LZString.compressToUTF16(JSON.stringify(snapshot));

    try {
      localStorage.setItem(key, compressed);
      localStorage.setItem(`${key}_meta`, JSON.stringify({
        savedAt: Date.now(),
        tick: snapshot.tick,
        version: snapshot.version
      }));
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('LocalStorage quota exceeded, clearing old saves');
        this.clearOldestSave();
        return this.save(snapshot, slot);
      }
      throw e;
    }
  }

  load(slot = 0) {
    const key = `${this.prefix}autosave_${slot}`;
    const compressed = localStorage.getItem(key);

    if (!compressed) return null;

    const json = LZString.decompressFromUTF16(compressed);
    return JSON.parse(json);
  }

  listSaves() {
    const saves = [];
    for (let i = 0; i < this.slotCount; i++) {
      const meta = localStorage.getItem(`${this.prefix}autosave_${i}_meta`);
      if (meta) {
        saves.push({ slot: i, ...JSON.parse(meta) });
      }
    }
    return saves.sort((a, b) => b.savedAt - a.savedAt);
  }

  clearOldestSave() {
    const saves = this.listSaves();
    if (saves.length > 0) {
      const oldest = saves[saves.length - 1];
      localStorage.removeItem(`${this.prefix}autosave_${oldest.slot}`);
      localStorage.removeItem(`${this.prefix}autosave_${oldest.slot}_meta`);
    }
  }
}
```

### 4.2 Cloud Storage (Supabase)

**Saves Table (Future):**

```sql
CREATE TABLE game_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_save_name UNIQUE(owner_id, name)
);
```

### 4.3 Autosave Triggers

| Trigger | Action |
|---------|--------|
| Every 60 seconds | Autosave to slot 0 (rotating) |
| Manual "Save" | Save to selected slot |
| Tab close (beforeunload) | Quick save to slot 0 |
| Game over | Final save for replay |

---

## 5. Schema Migration Strategy

### 5.1 Version Tracking

```javascript
const CURRENT_SCHEMA_VERSION = '1.0.0';

function migrate(snapshot) {
  const version = snapshot.version || '0.0.0';

  if (semver.lt(version, '1.0.0')) {
    snapshot = migrateFrom_0_to_1(snapshot);
  }

  // Add future migrations here

  snapshot.version = CURRENT_SCHEMA_VERSION;
  return snapshot;
}

function migrateFrom_0_to_1(snapshot) {
  // Example: Rename field
  for (const entity of Object.values(snapshot.entities)) {
    if (entity.unitData?.healthPoints !== undefined) {
      entity.unitData.hp = entity.unitData.healthPoints;
      delete entity.unitData.healthPoints;
    }
  }
  return snapshot;
}
```

### 5.2 Database Migrations (Supabase)

Use Supabase CLI migrations:

```bash
supabase migration new add_blueprint_licenses
```

Migration file:
```sql
-- migrations/20260121000000_add_blueprint_licenses.sql

CREATE TABLE blueprint_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES blueprints(id),
  licensee_id UUID NOT NULL REFERENCES profiles(id),
  granted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rollback
-- DROP TABLE blueprint_licenses;
```

### 5.3 Backward Compatibility

| Scenario | Handling |
|----------|----------|
| Load v0.9 save in v1.0 | Auto-migrate, warn user |
| Load v1.1 save in v1.0 | Reject with "Update required" message |
| Load corrupted save | Attempt recovery, offer backup |

---

## 6. Security Considerations

### 6.1 Row Level Security (RLS)

All tables have RLS enabled. Key policies:

- Users can only read/write their own data
- Public data (lobbies, public blueprints) readable by all
- No direct table access from client (use RPC for sensitive ops)

### 6.2 Input Validation

**Server-side (Supabase Functions):**

```javascript
// Example: Validate blueprint data before insert
const validateBlueprint = (data) => {
  // Check total allocation = 100
  const total = Object.values(data.features)
    .reduce((sum, f) => sum + f.allocation, 0);
  if (total !== 100) throw new Error('Allocation must sum to 100');

  // Check minimum allocation
  for (const [id, feature] of Object.entries(data.features)) {
    if (feature.allocation > 0 && feature.allocation < 20) {
      throw new Error(`Feature ${id} must have >= 20% allocation`);
    }
  }

  return true;
};
```

### 6.3 Rate Limiting

| Operation | Limit |
|-----------|-------|
| Create lobby | 5 per minute |
| Save blueprint | 10 per minute |
| Join lobby | 20 per minute |

Implemented via Supabase Edge Functions with rate limit headers.

---

## 7. Observability

### 7.1 Telemetry Events (Opt-in)

```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_user ON events(user_id);
CREATE INDEX idx_events_created ON events(created_at);
```

**Event Types:**

| Event | Payload |
|-------|---------|
| `game_started` | `{ mode, playerCount }` |
| `game_ended` | `{ duration, winner, reason }` |
| `unit_designed` | `{ blueprintId, features }` |
| `research_completed` | `{ featureId }` |
| `desync_detected` | `{ tick, hash }` |

### 7.2 Dashboard Queries

```sql
-- Active games in last hour
SELECT COUNT(*) FROM lobbies
WHERE status = 'PLAYING' AND updated_at > NOW() - INTERVAL '1 hour';

-- Most popular blueprints (public)
SELECT b.name, COUNT(l.id) as license_count
FROM blueprints b
LEFT JOIN blueprint_licenses l ON b.id = l.blueprint_id
WHERE b.is_public = true
GROUP BY b.id
ORDER BY license_count DESC
LIMIT 10;
```

---

*End of Appendix B*
