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

# HANDOFF SNAPSHOT (2026-02-01)
Start here → read [docs/HANDOFF_SNAPSHOT_2026-01-30.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/HANDOFF_SNAPSHOT_2026-01-30.md), then STATUS_WALKTHROUGH ## NOW.

## BOOTSTRAP INSTRUCTIONS
1. Read docs/START_HERE.md
2. Read docs/STATUS_WALKTHROUGH.md
3. Execute ## NOW from STATUS_WALKTHROUGH.

## REQUIRED: Consultation Round (Mandatory)
Before generating implementation prompts:
1. You MUST ask Antigravity (Gemini), CC1 (Claude), and CC2 (Claude) for their specific recommendations on the next step.
2. Synthesize their responses into a **Decision Packet** for Ádám.
3. Only proceed to Prompt Generation after Ádám approves the Decision Packet.

## SOURCE INTEGRITY (VERIFY ME)
- index.html: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/index.html
- src/Main.js: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/src/Main.js
- package.json: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/package.json

## OPENING PACK (RAW LINKS)

### Control & Status
- START_HERE: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/START_HERE.md
- STATUS_WALKTHROUGH: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/STATUS_WALKTHROUGH.md
- PLANNING_PROTOCOL: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/PLANNING_PROTOCOL.md
- IMPLEMENTATION_GATES: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/IMPLEMENTATION_GATES.md
- CANONICAL_SOURCES_INDEX: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/CANONICAL_SOURCES_INDEX.md
- CURRENT_SYSTEM_SPEC: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/CURRENT_SYSTEM_SPEC.md
- BUGBOOK: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/BUGBOOK.md
- REPO_REALITY_MAP: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/quality/archive/REPO_REALITY_MAP.md
- RELEASE_PLAN: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/RELEASE_PLAN.md
- [docs/WORKER_POOL_RUNBOOK.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/WORKER_POOL_RUNBOOK.md)

### Quality Archive / Reports
- [quality/archive/LOCAL_VS_GITHUB_PUBLISH_DIFF.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/quality/archive/LOCAL_VS_GITHUB_PUBLISH_DIFF.md)
- [quality/archive/NETCODE_PREFLIGHT.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/quality/archive/NETCODE_PREFLIGHT.md)
- [quality/archive/RELEASE_SYSTEM_REPORT.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/quality/archive/RELEASE_SYSTEM_REPORT.md)
- RELEASE_SYSTEM: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/RELEASE_SYSTEM.md
- VERSIONING_ROLLBACK: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/VERSIONING_ROLLBACK.md
- MAILBOX: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/MAILBOX.md
- IDEA_LOG: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/IDEA_LOG.md
- public/versions.json: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/public/versions.json

### Agent Notes
- NOTES_CHATGPT: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/NOTES_CHATGPT.md
- NOTES_ANTIGRAVITY: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/NOTES_ANTIGRAVITY.md
- NOTES_CLAUDE: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/NOTES_CLAUDE.md

### Canonical Specs (Snapshot 2026-01-14)
- MASTER_BIBLE: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md
- GRFDTRDPU_SYSTEM: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md
- FEATURE_MOVE_ROLL: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md
- FEATURE_WPN_SHOOT: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_WPN_SHOOT_2026-01-13.md
- FEATURE_OPTICAL_VISION: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION_2026-01-13.md
- FEATURE_SUBSURFACE_SCAN: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_SUBSURFACE_SCAN_2026-01-13.md
- FEATURE_MINING: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_MATERA_MINING_2026-01-13.md
- FEATURE_TRANSPORT: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_MATERA_TRANSPORT_2026-01-13.md
- FEATURE_TERRAIN_SHAPING: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_TERRAIN_SHAPING_2026-01-13.md
- FEATURE_UNIT_CARRIER: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_UNIT_CARRIER_2026-01-13.md
- FEATURE_UNIT_DESIGNER: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/spec_sources/ASTEROBIA_CANONICAL_FEATURE_UNIT_DESIGNER_2026-01-18.md

---END-PAYLOAD---
