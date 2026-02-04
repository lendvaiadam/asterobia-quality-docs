# SKILL: Supabase Schema

**ID**: `skill-supabase-schema`
**Role**: Backend / Data
**Status**: ACTIVE

---

## 1. Purpose
Design and manage the PostgreSQL database schema, including tables, indexes, extensions, and migrations.

## 2. Scope
- Table definitions (`CREATE TABLE`).
- Indexing strategies for performance.
- Foreign Key constraints.
- Migration file management (Supabase CLI).

## 3. Hard Constraints (MUST NOT)
- **NO Destructive Drops**: Must NOT drop tables or columns without a data migration path.
- **NO Breaking Changes**: Must NOT modify columns in a way that breaks existing serialization/code (Backward Compatibility).
- **NO Unversioned Changes**: All schema changes MUST be in numbered migration files (`supabase/migrations/`).

## 4. Triggers (When to Use)
- N05: Implementing persistent lobby (`sessions` table).
- N06: Implementing command logging (`command_log` table).
- Adding any persistent game data.

## 5. Checklist
- [ ] Migration file created with timestamp `YYYYMMDDHHMMSS_name.sql`.
- [ ] Primary Key defined (usually `id uuid DEFAULT gen_random_uuid()`).
- [ ] `created_at` and `updated_at` timestamps included.
- [ ] Foreign Keys have `ON DELETE` behavior defined.
- [ ] Indexes added for frequent query columns.

## 6. Usage Examples

### A. Creating a Sessions Table
```sql
create table public.sessions (
  id uuid not null primary key default gen_random_uuid(),
  host_id uuid references auth.users not null,
  is_active boolean default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
```

### B. Adding an Index
```sql
create index sessions_host_id_idx on public.sessions(host_id);
```

## 7. Out of Scope
- RLS Policies (Use `skill-supabase-rls`).
- Javascript logic (Use `skill-supabase-realtime`).
