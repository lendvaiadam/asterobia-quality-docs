# APPENDIX B: BACKEND & PERSISTENCE SCHEMA (v3)

**Parent Document:** [Big Picture Master Plan v3](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** Specification of the Supabase PostgreSQL schema, RLS Security Policies, and Auth workflows.

---

## 1. Database Architecture

We use **Supabase** (PostgreSQL) as the "Control Plane".
*   **No Game Logic:** The DB does not know what a "Unit" is. It only stores JSON Blobs.
*   **Realtime:** We use Supabase Realtime Channels for Lobby Signaling.

---

## 2. Schema Definition (SQL)

### 2.1 Profiles (User Identity)

Extensions to the default `auth.users`.

```sql
create table public.profiles (
  id uuid references auth.users(id) on delete cascade not null primary key,
  username text unique not null check (char_length(username) >= 3),
  avatar_url text,
  
  -- Meta Progression
  xp_total bigint default 0,
  rank_score int default 1000,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: Public Read, Self Write
create policy "Public profiles are viewable by everyone."
  on profiles for select using ( true );

create policy "Users can insert their own profile."
  on profiles for insert with check ( auth.uid() = id );

create policy "Users can update own profile."
  on profiles for update using ( auth.uid() = id );
```

### 2.2 Blueprints (User Content)

This is where "Unit Designs" live.

```sql
create table public.blueprints (
  id uuid default uuid_generate_v4() primary key,
  owner_id uuid references public.profiles(id) not null,
  
  -- Identity
  name text not null check (name ~ '^[A-Z]{6}[0-9]+$'), -- E.g. MORDIG10
  version int not null default 10, -- Capacity / 10
  
  -- The Spec (Immutable)
  data jsonb not null, 
  /* Example JSON check constraint could be added here */
  
  -- Assets (Links to Storage)
  model_url text, -- .glb path
  thumb_url text, -- .png path
  
  is_public boolean default false,
  forked_from uuid references public.blueprints(id),
  
  created_at timestamptz default now()
);

-- RLS: Public Read (if is_public OR is_owner), Owner Write
create policy "Public Blueprints read"
  on blueprints for select
  using ( is_public = true or auth.uid() = owner_id );

create policy "Owners delete blueprints"
  on blueprints for delete
  using ( auth.uid() = owner_id );
```

### 2.3 Lobbies (Matchmaking)

Ephemeral rows representing active games.

```sql
create type lobby_status as enum ('OPEN', 'STARTING', 'PLAYING', 'CLOSED');

create table public.lobbies (
  id uuid default uuid_generate_v4() primary key,
  host_id uuid references public.profiles(id) not null,
  
  -- Signaling
  host_peer_id text not null, -- The PeerJS ID
  
  status lobby_status default 'OPEN',
  
  -- Config
  name text not null,
  region text default 'eu-central',
  max_players int default 4,
  current_players jsonb default '[]'::jsonb, -- Array of Profile objects
  
  last_heartbeat timestamptz default now()
);

-- Cron Job (pg_cron) needed to clean up stale lobbies where last_heartbeat > 5min
```

---

## 3. Storage Buckets & Policies

We need a bucket `user_content` for Generative AI assets.

### 3.1 Bucket: `user_content`
*   **Structure:** `/{user_id}/{blueprint_id}/{filename}`
*   **Files:** `model.glb`, `thumb.png`.
*   **Policies:**
    *   **Select:** Public.
    *   **Insert:** Authenticated Users (folder name must match `auth.uid()`).
    *   **Update:** Authenticated Owner.

```sql
-- Storage Policy Example
create policy "Allow user uploads"
on storage.objects for insert
with check (
  bucket_id = 'user_content' 
  and (storage.foldername(name))[1]::uuid = auth.uid()
);
```

---

## 4. Auth & Signaling Workflow

### 4.1 Signaling Flow (The "Handshake")

Since we don't have a dedicated Signaling Server, we use Supabase Realtime roughly like this:

1.  **Host** creates row in `lobbies` with `host_peer_id`.
2.  **Host** subscribes to `postgres_changes` on that row.
3.  **Client** fetches row, gets `host_peer_id`.
4.  **Client** connects via PeerJS (WebRTC).
5.  *Wait...* (PeerJS handles the SDP Offer/Answer via its own cloud signaling usually, BUT we can supply our own if we want strict control. Phase 1: Keep it simple, use PeerJS cloud).

**Decision:** We will use **PeerJS Cloud** involved for SDP exchange (it's free/cheap), but use **Supabase** for Lobby listing.
*   Supabase = "Phone Book" (Here is my number).
*   PeerJS = "The Call" (Connects via that number).

### 4.2 Auth Token Implementation

The Client must send its `JWT` to the Host?
**Phase 1:** No. Host trusts Client's claimed identity.
**Phase 2:** Simple signature verification.
1.  Client signs `Timestamp` with Private Key (from Login).
2.  Host verifies against Public Key (fetched from Supabase).
*Actually, Supabase usage implies we are logged in. We can just trust the `user_id` if the Lobby Join logic is protected.*

---

## 5. JSON Schemas

### 5.1 The `Blueprint.data` JSON

This is the most critical persisted blob.

```json
{
  "schema": "v1",
  "name": "MORDIG",
  "capacity": 100,
  "features": {
    "MOVE_ROLL": {
      "enabled": true,
      "allocation": 40, // 40% of standard stats
      "mods": {
        "speed": 1.2,
        "climb": 0.8
      }
    },
    "MATERA_MINING": {
      "enabled": true,
      "allocation": 60,
      "mods": {
        "efficiency": 1.5
      }
    }
  },
  "visuals": {
    "seed": 123456,
    "primaryColor": "#FF0000",
    "prompt": "A spiky drilling bug with large wheels"
  }
}
```

---
*End of Appendix*
