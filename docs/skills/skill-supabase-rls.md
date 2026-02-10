# SKILL: Supabase RLS

**ID**: `skill-supabase-rls`
**Role**: Backend / Security
**Status**: ACTIVE

---

## 1. Purpose
Design, implement, and verify Row-Level Security (RLS) policies for Supabase tables to ensure strict data access control.

## 2. Scope
- Policy definition: `.sql` migration files for `CREATE POLICY`.
- Verification: Testing policies via multiple user roles (Anon, Authenticated, Host).
- Debugging: Analyzing access denied errors.

## 3. Hard Constraints (MUST NOT)
- **NO Disability**: Must NOT disable RLS on any table (Security Defect).
- **NO Public Write**: Must NOT grant public/anon `INSERT`/`UPDATE` without explicit Architecture Review.
- **NO Service Role**: Must NOT rely on `service_role` in client code to bypass policies.

## 4. Triggers (When to Use)
- Creating new tables (e.g., `sessions`, `command_log`).
- Modifying schema or access patterns.
- Auditing security.

## 5. Checklist
- [ ] RLS is enabled on the table (`ALTER TABLE x ENABLE ROW LEVEL SECURITY`).
- [ ] `SELECT` policy defined (who can read?).
- [ ] `INSERT`/`UPDATE` policy defined (who can write?).
- [ ] Policies use `auth.uid()` where applicable.
- [ ] No "Permissive" policies that accidentally open full access.

## 6. Usage Examples

### A. Host-Only Write Access
```sql
CREATE POLICY "Hosts can update their own sessions"
ON public.sessions
FOR UPDATE
USING (auth.uid() = host_id);
```

### B. Public Read Access
```sql
CREATE POLICY "Anyone can view active sessions"
ON public.sessions
FOR SELECT
USING (is_public = true);
```

## 7. Out of Scope
- Table creation (Use `skill-supabase-schema`).
- Edge Function security.
