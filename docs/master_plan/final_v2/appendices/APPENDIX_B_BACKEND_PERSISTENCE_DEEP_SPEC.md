# APPENDIX B: BACKEND & PERSISTENCE DEEP SPEC

**Parent Document:** [MASTER_PLAN_FINAL_v2.md](../MASTER_PLAN_FINAL_v2.md)
**Scope:** Supabase architecture, schema, RLS, cost management, migration

---

## 1. Supabase Architecture

### 1.1 Services Used

| Service | Purpose | Tier Limit (Free) | Tier Limit (Pro) |
|---------|---------|-------------------|------------------|
| Auth | User authentication | Unlimited users | Unlimited |
| Database | Game data, lobbies | 500MB | 8GB |
| Realtime | Signaling, presence | 200 concurrent | 500 concurrent |
| Storage | Game saves, replays | 1GB | 100GB |

### 1.2 Connection Pattern

```javascript
// src/backend/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export { supabase };
```

---

## 2. Database Schema

### 2.1 Core Tables

```sql
-- User profiles (extends Supabase Auth)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Game saves
CREATE TABLE game_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  snapshot JSONB NOT NULL,
  command_log JSONB,
  tick INT NOT NULL DEFAULT 0,
  play_time_seconds INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_game_saves_user ON game_saves(user_id);
CREATE INDEX idx_game_saves_updated ON game_saves(updated_at);

-- Lobbies for multiplayer
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES profiles(id),
  name TEXT NOT NULL,
  password_hash TEXT,
  max_players INT DEFAULT 4 CHECK (max_players BETWEEN 2 AND 4),
  current_players INT DEFAULT 1,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_game', 'finished')),
  game_settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_lobbies_status ON lobbies(status) WHERE status = 'waiting';

-- Lobby members
CREATE TABLE lobby_members (
  lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  player_slot INT NOT NULL CHECK (player_slot BETWEEN 1 AND 4),
  is_ready BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lobby_id, user_id),
  UNIQUE (lobby_id, player_slot)
);

-- Training records
CREATE TABLE training_records (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  high_score INT NOT NULL CHECK (high_score BETWEEN 0 AND 100),
  global_multiplier NUMERIC(4,2) NOT NULL,
  attempts INT DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, feature_id)
);
```

### 2.2 Row Level Security

```sql
-- Profiles: users see all, update own
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Game saves: only own
ALTER TABLE game_saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own saves" ON game_saves
  FOR ALL USING (auth.uid() = user_id);

-- Lobbies: public read, host manages
ALTER TABLE lobbies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view waiting lobbies" ON lobbies
  FOR SELECT USING (status = 'waiting' OR host_id = auth.uid());

CREATE POLICY "Users can create lobbies" ON lobbies
  FOR INSERT WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Host can update lobby" ON lobbies
  FOR UPDATE USING (auth.uid() = host_id);

CREATE POLICY "Host can delete lobby" ON lobbies
  FOR DELETE USING (auth.uid() = host_id);

-- Lobby members
ALTER TABLE lobby_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view lobby members" ON lobby_members
  FOR SELECT USING (true);

CREATE POLICY "Users can join/leave" ON lobby_members
  FOR ALL USING (auth.uid() = user_id);

-- Training records: only own
ALTER TABLE training_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own training" ON training_records
  FOR ALL USING (auth.uid() = user_id);
```

---

## 3. Storage Buckets

```sql
-- Create storage bucket for game saves
INSERT INTO storage.buckets (id, name, public)
VALUES ('game-saves', 'game-saves', false);

-- RLS for storage
CREATE POLICY "Users can upload own saves" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'game-saves' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can read own saves" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'game-saves' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
```

---

## 4. Persistence Operations

### 4.1 Save Game

```javascript
async function saveGame(userId, name, simCore) {
  const snapshot = simCore.serialize();
  const commandLog = simCore.commandLog.export();

  // Compress if large
  const snapshotStr = JSON.stringify(snapshot);
  const compressedSnapshot = snapshotStr.length > 100000
    ? await compress(snapshotStr)
    : snapshot;

  const { data, error } = await supabase
    .from('game_saves')
    .insert({
      user_id: userId,
      name,
      snapshot: compressedSnapshot,
      command_log: commandLog,
      tick: simCore.tick,
      play_time_seconds: Math.floor(simCore.tick / 20)
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

### 4.2 Load Game

```javascript
async function loadGame(saveId) {
  const { data, error } = await supabase
    .from('game_saves')
    .select('*')
    .eq('id', saveId)
    .single();

  if (error) throw error;

  // Decompress if needed
  const snapshot = typeof data.snapshot === 'string'
    ? JSON.parse(await decompress(data.snapshot))
    : data.snapshot;

  return { snapshot, commandLog: data.command_log };
}
```

### 4.3 Autosave

```javascript
class AutosaveManager {
  constructor(simCore, userId) {
    this.simCore = simCore;
    this.userId = userId;
    this.lastSaveTick = 0;
    this.AUTOSAVE_INTERVAL = 1200; // Every 60 seconds (20Hz)
  }

  tick() {
    if (this.simCore.tick - this.lastSaveTick >= this.AUTOSAVE_INTERVAL) {
      this.autosave();
      this.lastSaveTick = this.simCore.tick;
    }
  }

  async autosave() {
    try {
      await saveGame(this.userId, 'Autosave', this.simCore);
      console.log('Autosave complete at tick', this.simCore.tick);
    } catch (e) {
      console.error('Autosave failed:', e);
    }
  }
}
```

---

## 5. Cost Management

### 5.1 Monitoring

```javascript
// Check storage usage
async function checkStorageUsage() {
  const { data, error } = await supabase
    .rpc('get_storage_usage');

  if (data.bytes_used > data.bytes_limit * 0.8) {
    console.warn('Storage usage at 80%');
    triggerCleanup();
  }
}
```

### 5.2 Degrade Paths

| Trigger | Action |
|---------|--------|
| Storage > 80% | Delete autosaves older than 7 days |
| Storage > 90% | Delete all autosaves, keep manual only |
| Realtime connections > 80% | Queue new lobby joins |
| Database > 80% | Archive old finished lobbies |

### 5.3 Cleanup Function

```sql
-- Scheduled cleanup (Supabase Edge Function or cron)
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
  -- Delete old autosaves
  DELETE FROM game_saves
  WHERE name = 'Autosave'
    AND updated_at < NOW() - INTERVAL '7 days';

  -- Delete old finished lobbies
  DELETE FROM lobbies
  WHERE status = 'finished'
    AND finished_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
```

---

## 6. Migration Strategy

### 6.1 Schema Versioning

```sql
CREATE TABLE schema_migrations (
  version INT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Example migration
-- migrations/001_initial_schema.sql
INSERT INTO schema_migrations (version, name)
VALUES (1, 'initial_schema');
```

### 6.2 Data Migration

For snapshot format changes:

```javascript
function migrateSnapshot(snapshot, fromVersion, toVersion) {
  let migrated = snapshot;

  if (fromVersion < 2 && toVersion >= 2) {
    // v1 -> v2: Add command queue to entities
    for (const entity of Object.values(migrated.entities)) {
      entity.queueState = { isPlaying: true, lanes: {} };
    }
    migrated.version = 2;
  }

  return migrated;
}
```

---

*End of Appendix B*