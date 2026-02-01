---BEGIN-PAYLOAD---

# CONTEXT RESET PACK

**Purpose**: Allows any AI agent (Antigravity, Claude, ChatGPT) to instantly resume work with full context.

---

## 1. Where we are now (Status)
- **Phase 0 (Netcode Readiness)**: COMPLETE
- **Phase 1 (Multiplayer)**: IN PROGRESS
- **Release Status**:
    - `R010` (Determinism): DONE
    - `R011` (Persistence): DONE
    - `R012` (Supabase HUD/Config): DONE (Verified `savepoint/r012-hud-fix-verified`)
    - `R013` (Specs & Schema): DOCS DONE (Merged `savepoint/docs-opening-pack-fixed`)
- **NEXT UP**: **Release 013 Implementation** (Host-Authority Handshake + Command Batching).

---

## 2. Known-Good Pointers (Source of Truth)
- **Repo Head**: `main` (Use latest SHA)
- **Safe Savepoints**:
    1. `savepoint/docs-repair` (Latest): Fixed Docs + R13 Specs.
    2. `savepoint/r012-hud-fix-verified`: Working R012 HUD.
- **Key Specs (Binding)**:
    - [R012_SUPABASE_SETUP.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/specs/R012_SUPABASE_SETUP.md)
    - [R012_CONFIG_AND_SECRETS_STRATEGY.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/specs/R012_CONFIG_AND_SECRETS_STRATEGY.md)
    - [R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md)
    - [PERSISTENT_WORLD_STATE_NOTES.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/specs/PERSISTENT_WORLD_STATE_NOTES.md)

---

## 3. Roster & Roles
- **Antigravity (Gemini)**: Integrator, Auditor, Savepoint Manager. (No deep coding).
- **Claude Code #1**: **Runtime Implementation**. (Builds features, runs tests).
- **Claude Code #2**: **Spec/Docs Writer**. (Writes specs, updates plans). *Docs-only by default.*
- **ChatGPT**: Spec Guardian & Prompt Writer. (Read-only on repo).

---

## 4. Two-Claude Safety Rules (Mandatory)
1.  **Partitioning**:
    - CC#1 owns `src/**` (Runtime).
    - CC#2 owns `docs/**` (Specs).
    - Exceptions require explicit coordination via Antigravity.
2.  **Concurrency**:
    - Never work on the same file at the same time.
    - Always `git pull` before starting a task.
    - Declare file ownership clearly in PR/Commit messages.

---

## 5. Resume in 5 Minutes
1.  **Open**: [docs/START_HERE.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/START_HERE.md) & [docs/STATUS_WALKTHROUGH.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/STATUS_WALKTHROUGH.md).
2.  **Run Server**: `npx http-server . -c-1 -p 8081`
3.  **Golden URL**: [http://localhost:8081/game.html?dev=1&net=supabase](http://localhost:8081/game.html?dev=1&net=supabase)
4.  **HU Checks**:
    - **HUD**: Verify `CONFIG: OK`, `AUTH: ANON OK` (or FAIL if no key), `REALTIME: CONNECTED/CONNECTING`.
    - **Persistence**: Click [Save], Refresh, Click [Load]. Unit position should restore.
    - **RLS**: Open Incognito window (simulate Client B).

---

## 6. Next Plan (High-Level)
- **Objective**: Implement **R013 Host-Authority Handshake**.
- **Scope**:
    - `SupabaseTransport` joins channel.
    - First client claims 'Host'. Second client becomes 'Peer'.
    - Peer sends input -> Host consumes -> Host broadcasts Snapshot -> Peer renders.
- **NOT in scope yet**:
    - Client-side prediction (R015+).
    - Authoritative Server Simulation (Node/Deno).
    - Offline progression.

---
**Last Updated**: 2026-02-01

---END-PAYLOAD---
