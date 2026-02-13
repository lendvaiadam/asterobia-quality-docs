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

## 8. Claude Code — Operating Principles (Binding)
*   **Best Implementer:** Avoid micromanagement. Focus on outcomes, safety, and production-grade quality.
*   **Proactive Proposal:** Everything the human writes is guidance; Claude may propose better approaches. If deviating materially, explain why and get explicit approval first.
*   **State-of-the-Art:** Aim for "better and best" solutions, not just literal instructions.
*   **External Auditor:** Use Antigravity as an external architect/auditor. Ask for review on significant design decisions (protocol, authority, determinism, security).
*   **Skill Acquisition:** actively check for relevant "skills" (domains) and acquire/assign them to workers.
*   **Multi-Worker Strategy:** Run multiple workers with complementary skills (netcode, physics, security, testing) to maintain AAAA+ quality.

## 9. Context Budget & Response Format (Binding)
*   **PRIORITY ORDER:**
    1) **Production-ready quality & correctness.**
    2) **Conciseness** (Preserve context budget).
*   **No Narratives:** Avoid long filler, repeated restatements, or "play-by-play" diaries.
*   **Default Response Structure:**
    *   **Decision / Status** (1–2 lines)
    *   **What changed** (bullets, max ~6)
    *   **How to verify** (commands, short)
    *   **Risks / Open Questions** (only if real, max ~3)
*   **Gating Info (Mandatory):** Always provide Branch, Commit SHAs, Test Result Summary, Diffstat, and Compliance Check (YES/NO).
*   **Wait for Ask:** If more detail is needed, wait to be asked rather than preemptively dumping logs.

## 10. Claude Output Contract (Prompt Budget / Minimal Reporting) (Binding)
**Status: ENFORCED ALWAYS**

For every implementation update / commit summary, follow these reporting rules:

### Principle
*   **Default:** Concise, complete, high-signal summaries.
*   **Rule:** Never omit critical info for brevity, but do not expand unless necessary.

### Required (Always Included)
*   **Branch + Commit SHA** (Concrete SHAs only, NEVER "HEAD").
*   **Diffstat + List of touched files**.
*   **Tests:** Command(s) + PASS count (one line).
*   **HU Verification Steps** (3–6 bullets max).
*   **Risks / Open Questions** (1–3 bullets max).
*   **Changes:** Explicit callout if any defaults/flags/caps changed.

### Forbidden (Do NOT Output unless requested)
*   Tool logs (Bash/Explore/Read/Write traces).
*   Long narrative / redundant explanations.
*   Speculative arithmetic or "I think" recounting.
*   Multi-paragraph decision essays.

### Exception Clause
*   If a change is risky/complex or introduces non-obvious behavior, you MAY exceed the minimal format.
*   **Condition:** You must label the section: `**Extended detail because: [Reason]**`.
*   **Constraint:** Keep it structured and non-redundant.

> **Reminder:** Concise answers preserve context; prioritize code quality, then brevity.
