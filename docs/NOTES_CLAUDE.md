# NOTES — Claude (Implementation & Planning)

**Purpose:** Persistent memory for Claude / Claude Code. Read this at the start of every session.

## 1. Interaction Guidelines (Binding)
*   **Token Efficiency:** Do NOT waste tokens on long conversational filler.
*   **Focus:** High-quality coding is the priority.
*   **Chat Style:** Concise, precise, engineering-focused.
    *   *Bad:* "Certainly! I would be happy to help you with that. Here is a comprehensive explanation of..."
    *   *Good:* "Fixed. Implementation details: ..."
*   **Omission:** Do not include code or text in the chat unless it is necessary for the context or explicitly requested.

## 2. Workflows
*   **Master Plan:** Follow `docs/master_plan/MASTER_DEVELOPMENT_PLAN_Merged_v1.md` (once created).
*   **Skills:** Use repo-native skills in `/.claude/skills/` for Determinism, UI, and Testing. See `docs/CLAUDE_CODE_SKILLS.md`.
## 4. Binding Rules (Consolidated)
*   **Remote Discipline:**
    *   **Code** (`src/`, `package.json`): Push to `code` remote (`lendvaiadam/asterobia`).
    *   **Docs** (`docs/`, `quality/`): Push to `origin` remote (`lendvaiadam/asterobia-quality-docs`).
    *   **Phase 0 Exception:** Currently all work pushed to `origin`. Do NOT push to `code` until explicitly instructed.
*   **Determinism Invariant:**
    *   **ZERO** non-deterministic code allowed in SimCore.
    *   Forbidden: `Date.now()` (logic), `Math.random()` (unseeded), `requestAnimationFrame` (sim).
    *   **Input Rule:** Input/UI emits Commands; only `SimCore.step` consumes commands.
*   **Testing Rule (Binding):**
    *   Every commit/PR description must include a **HU (Human-Usable) Test Script**.
    *   After EVERY implementation step, output a "Test Checklist (Ádám)" section.
*   **Bug Backlog Protocol:**
    *   Canonical Source: `docs/BUGLIST.md`
    *   Record bugs IMMEDIATELY. Fixing is optional; recording is mandatory.
*   **Communication:**
    *   **Mailbox:** Agent-sync only.
    *   **Changes:** Broadcast what changed + RAW links + playable URL in every reply.
    *   **Reference:** Always name exact file paths.

## 5. Implementation Order (Phase 0 Target)
1) Fixed-timestep SimCore heartbeat (DONE).
2) Command buffer per tick (DONE).
3) Deterministic IDs + seeded RNG (DONE).
4) Snapshot export (DONE).
5) ITransport Local shim (Release 007 - NEXT).

## 6. Claude Code Instances (2) (Binding)
- **CC#1 (Runtime)**: Owns `src/` and implementation.
- **CC#2 (Docs)**: Owns `docs/` and specs.
- **Rule**: Never edit the same file concurrently. `git pull` before starting.
- **Ref**: `docs/CONTEXT_RESET_PACK.md`

## 7. Risks
- Unit.js is a monolith. Avoid deep rewrites; prefer routing through shim entrypoints.

