# MAINTENANCE RULES (BINDING)

**Current Phase:** POST-PLAN EXECUTION (Master Plan v2 Merged)

**Immediate Context:**
- **Authoritative Plan:** `docs/master_plan/final_v2/`
- **Goal:** Execute Work Packages as defined in the Final Plan.
- This file is the single source of truth for the ChatGPT opening pack.
- Any agent who creates/introduces a new file that ChatGPT must read MUST update this file (and push).
- The pack should prefer stable main RAW links, but if WIP is on a pinned commit, include commit-SHA RAW links.

---

## COPY/PASTE INTO A NEW CHAT

TE VAGY A ChatGPT — Spec Guardian & Prompt Writer!

---BEGIN-PAYLOAD---

# ASTEROBIA: HANDOFF SNAPSHOT (2026-02-01)

*Auto-generated Context & Workflow Starter*

## 1. CURRENT STATE (From Context Reset)

- **Phase 0 (Netcode Readiness)**: COMPLETE
- **Phase 1 (Multiplayer)**: IN PROGRESS
- **Release Status**:
  - `R010` (Determinism): DONE
  - `R011` (Persistence): DONE
  - `R012` (Supabase HUD/Config): DONE (Verified `savepoint/r012-hud-fix-verified`)
  - `R013` (Specs & Schema): DOCS DONE (Merged `savepoint/docs-opening-pack-fixed`)
- **NEXT UP**: **Release 013 Implementation** (Host-Authority Handshake + Command Batching).

## 2. WORKFLOW (MANDATORY)

**Before generating implementation prompts:**
1. **Consultation Round**: You MUST ask Antigravity (Gemini), CC1 (Claude), and CC2 (Claude) for their specific recommendations on the next step.
2. **Decision Packet**: Synthesize their responses into a structured Decision Packet for Ádám.
3. **Approval Gate**: Only proceed to Prompt Generation after Ádám approves the Decision Packet.

## 3. DOC-ANSWER GATE (BINDING)

When answering questions or checking plans, you must explicitly list which RAW links you read to verify your answer.
Example: `[Source: START_HERE.md (read)]`

## 4. FULL LINK LIBRARY (RAW SOURCES)

*Use these links to ground your context. Hard refresh if 404.*

### A. Control & Status (Bootstrap)

- START_HERE: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/START_HERE.md
- STATUS_WALKTHROUGH: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/STATUS_WALKTHROUGH.md
- PLANNING_PROTOCOL: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/PLANNING_PROTOCOL.md
- IMPLEMENTATION_GATES: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/IMPLEMENTATION_GATES.md
- CANONICAL_SOURCES_INDEX: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/CANONICAL_SOURCES_INDEX.md
- CURRENT_SYSTEM_SPEC: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/CURRENT_SYSTEM_SPEC.md
- BUGBOOK: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/BUGBOOK.md
- RELEASE_PLAN: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/RELEASE_PLAN.md
- WORKER_POOL_RUNBOOK: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/WORKER_POOL_RUNBOOK.md

### B. Specs & Features (Canonical)

- MASTER_BIBLE: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md
- GRFDTRDPU_SYSTEM: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md
- R012_SUPABASE_SETUP: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/specs/R012_SUPABASE_SETUP.md
- R013_MULTIPLAYER_HANDSHAKE: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md
- FEATURE_MOVE_ROLL: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md
- FEATURE_WPN_SHOOT: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_WPN_SHOOT_2026-01-13.md

### C. Quality & Reports

- NETCODE_PREFLIGHT: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/quality/archive/NETCODE_PREFLIGHT.md
- REPO_REALITY_MAP: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/quality/archive/REPO_REALITY_MAP.md
- RELEASE_SYSTEM_REPORT: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/quality/archive/RELEASE_SYSTEM_REPORT.md

### D. Agent Notes & Logs

- NOTES_CHATGPT: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/NOTES_CHATGPT.md
- NOTES_ANTIGRAVITY: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/NOTES_ANTIGRAVITY.md
- NOTES_CLAUDE: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/NOTES_CLAUDE.md
- MAILBOX: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/MAILBOX.md
- IDEA_LOG: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/IDEA_LOG.md

### E. Source Integrity (Code)

- index.html: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/index.html
- src/Main.js: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/src/Main.js
- package.json: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/package.json

---END-PAYLOAD---
