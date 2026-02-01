# START HERE — Asterobia Control Entry Point (Stable)
This file is the single entrypoint link you can give to any AI (ChatGPT, Antigravity Gemini, Claude, Claude Code).
It contains stable rules, roles, and pointers to where everything lives.

---

## What this project is
Asterobia/Asterobia is a strategy/simulation game project.
Current engineering priority: Refactor toward Phase 0 “Netcode Readiness” (host-authoritative, deterministic, backend-ready).

---

## Roles (who does what)

### Ádám (Human Owner / Router)
- Proposes ideas in Hungarian.
- Reads HU impact/consequence notes and decides priorities/scope.
- Relays English prompts between AIs (copy/paste).
- Executes HU test scenarios and reports results in Hungarian.
- Approves acceptance decisions (PASS/FAIL); agents perform merges after explicit approval.

### Antigravity (Gemini) — Repo Operator / Integrator / Quality Gatekeeper
- **Repo Operator**: PR packaging, releases, git operations, doc updates.
- **Integrator**: Reviews Claude's code, runs compliance checks (determinism, sizing), manages the merge process.
- **Quality**: Enforces gates, rollbacks, and delivers evidence (commit SHA, RAW links).
- **Escalation Rule**: If a PR is risky/complex → Claude codes, Antigravity reviews/packages. If mechanical → Antigravity may code.

### Tools / Workflow / How we work
- **Source of Truth**: `docs/START_HERE.md` (this file)
- **Work Tracking**: `docs/STATUS_WALKTHROUGH.md`
- **Bug Tracking**: `docs/BUGLIST.md`
- **Claude Skills**: `docs/CLAUDE_CODE_SKILLS.md` (See `/.claude/skills/` for local tools)
- **Context Reset Pack**: `docs/CONTEXT_RESET_PACK.md` (Fast resume & context recovery)
- **R012 Config Strategy**: `docs/specs/R012_CONFIG_AND_SECRETS_STRATEGY.md` (Prod-grade secrets management)
- **R013 Multiplayer Spec**: `docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md` (Host Authority Handshake)

### Claude / Claude Code — Coder-of-Remember
- **Primary Coder**: Implements complex features and core systems.
- **Planner**: Authors concrete plan packages and PR sequences.
- **Focus**: Pure implementation velocity within the constraints set by Antigravity.

### ChatGPT — Spec Guardian & Prompt Writer
- Produces prompts for Claude and Antigravity.
- Read-only on GitHub; requests doc edits via Antigravity using exact patches.

---

## CHATGPT OPENING PACK (BINDING)

- The canonical, self-updating opening message + RAW link library lives in:
  https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/CHATGPT_OPENING_PACK.md

**Fresh ChatGPT session procedure**
1) ChatGPT reads START_HERE.
2) ChatGPT opens CHATGPT_OPENING_PACK.md.
3) ChatGPT pastes the “COPY/PASTE INTO A NEW CHAT” block into the chat for Ádám.
4) Ádám copies that exact block and pastes it back as the next user message (so the full file library is present in the conversation).

**New file announcement rule (binding)**
If an agent creates a new repo file that ChatGPT must read and it is not yet listed in CHATGPT_OPENING_PACK.md, the creator MUST:
- Send the RAW link (commit-SHA RAW if not on main) + 1-line purpose via Ádám in chat,
- Update CHATGPT_OPENING_PACK.md to include it,
- Push to GitHub (SYNC) and provide commit SHA + commit-SHA RAW links.

**Payload integrity rules (binding)**: See `docs/NOTES_CHATGPT.md` for BEGIN/END markers, chunking, and 1-payload-per-message requirements.

## FIRST WORK PACKAGE — FULL MASTER DEVELOPMENT PLAN (BINDING)
Before any “first steps”, PR sequencing, or Phase 0 execution planning:
1) **Antigravity** and **Claude Code** MUST read **ALL** available project materials:
   - every `*.md` in the repo (docs/, quality/, publish/ snapshots, baseline/ where relevant)
   - plus the key code entrypoints needed to understand reality (e.g. `package.json`, `src/Main.js`, and any listed “entry” files in docs).
2) Each must produce an independent **end-to-end Master Development Plan** to the final target:
   - gameplay/feature roadmap (dependencies, unlocks, core loops)
   - UI/UX + design pipeline (how design feeds implementation)
   - multiplayer + backend plan (staging: local → host-authoritative → backend services)
   - persistence/state strategy (snapshots/replay/storage)
   - engineering architecture + repo structure implications
   - releases/milestones with “Done When” gates
   - test/QA strategy + risk register
   - a 5-worker Work Package map (what can be parallelized)
3) Output must be a single Markdown plan in chat, ending with **max 3 blocking questions**.
Only after both Master Plans exist and are synthesized/approved do we request PR-by-PR plans.

## Fresh Session Bootstrap (BINDING)
> **On a fresh session:** DO NOT ask questions. First read the Required Reading Set below. Then open `docs/STATUS_WALKTHROUGH.md` and execute **## NOW**. Ask only if a required link/input is missing.
>
> **NOTE (2026-01-29):** The "Request Master Plan" phase is OVER. Master Plan v2 is merged. Do NOT generate new plans. Execute the existing one.

### Required Reading Set (BINDING)
1) `docs/STATUS_WALKTHROUGH.md` (execute ## NOW after reading)
2) `docs/IMPLEMENTATION_GATES.md`
3) `docs/CANONICAL_SOURCES_INDEX.md` (use the “Absolute Raw Links” section if raw-view breaks relative links)
4) `docs/RELEASE_PLAN.md`

### Canonical Spec Sources (BINDING)
You MUST read these binding specs from `publish/quality_docs_snapshot_2026-01-14/spec_sources/`:
- `ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md`
- `ASTEROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md`
- `ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md`
- `ASTEROBIA_CANONICAL_VISION_MAX_SOURCES_POLICY_2026-01-13.md`
- All 8 Feature Specs:
  - `ASTEROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md`
  - `ASTEROBIA_CANONICAL_FEATURE_WPN_SHOOT_2026-01-13.md`
  - `ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION_2026-01-13.md`
  - `ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_SUBSURFACE_SCAN_2026-01-13.md`
  - `ASTEROBIA_CANONICAL_FEATURE_MATERA_MINING_2026-01-13.md`
  - `ASTEROBIA_CANONICAL_FEATURE_MATERA_TRANSPORT_2026-01-13.md`
  - `ASTEROBIA_CANONICAL_FEATURE_TERRAIN_SHAPING_2026-01-13.md`
  - `ASTEROBIA_CANONICAL_FEATURE_UNIT_CARRIER_2026-01-13.md`
  - `ASTEROBIA_CANONICAL_FEATURE_UNIT_DESIGNER_2026-01-18.md`

### Read-only / Write protocol (BINDING)
- **ChatGPT**: GitHub read-only; any file edits must be executed by Antigravity via commit+push, returning commit hash + raw links.
- **Claude Code**: May commit code; Antigravity may commit docs; all changes must be linked back.

---

## Write-access rule (Binding)
- ChatGPT is read-only on GitHub files.
- If ChatGPT wants to update docs (STATUS_WALKTHROUGH / MAILBOX / NOTES_* / START_HERE), it must:
  1) propose an exact patch (insert/replace lines),
  2) instruct Antigravity to apply ONLY that patch,
  3) require commit + push and return raw link + commit hash.
- Ádám does not commit. Antigravity is the default docs operator. Claude Code is the default code operator.

---

## Workflow (how we work)
1. **Plan Phase**: Claude authors Plan/PR packages. Antigravity audits.
2. **Implementation**: Claude (default) or Antigravity (if mechanical) executes implementation.
3. **Integration**: Antigravity enforces quality gates, runs tests, and packages the Commit.
4. **Approval**: Ádám provides PASS/FAIL.
- Agents communicate through Ádám (copy/paste relay).
- Canonical docs are binding. If anything conflicts: Canonical > Audit notes > Chat.
- Implementation is done as small PR branches (prX-...). Merged to main by Antigravity or the implementing agent AFTER Ádám’s- Implementation is done as small PR branches (prX-...). Merged to main by Antigravity or the implementing agent AFTER Ádám’s explicit PASS/approval in chat. Ádám never performs Git operations.
- **Mailbox Restriction**: MAILBOX is agent-to-agent output sync only. Never instruct Ádám to read it. Delivery of prompts/info to other agents must happen via Ádám in chat (paste-ready), with rationale.

## Language Rules (Binding)
- Do NOT add Hungarian translations to coding prompts. English-only for inter-agent coding prompts. Hungarian is only for Ádám-facing summaries and HU test scenarios.
- **Planning Protocol (Binding)**: [docs/PLANNING_PROTOCOL.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/PLANNING_PROTOCOL.md). All implementation work must follow this.
- **Fresh session rule (binding)**: Open [docs/STATUS_WALKTHROUGH.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/STATUS_WALKTHROUGH.md) and follow the **## NOW** section before asking any questions.
- **Spec Update Rule**: After any Release is completed and verified: update [CURRENT_SYSTEM_SPEC](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/CURRENT_SYSTEM_SPEC.md) with what changed.
- **Bugbook Rule**: When a recurring issue is discovered/fixed twice: add it to [BUGBOOK](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/BUGBOOK.md).

---
## VISIBILITY & PUSH GATE (BINDING)
- **Any EDIT REPO task MUST end with commit+push to GitHub (branch OK)**
- **“Done” requires commit SHA + commit-SHA RAW links for all changed files**
- **Local-only changes are not acceptable**; if push fails, STOP and paste exact error.
- **If prompted “Run command? git push …” you MUST proceed (required step).**
- **No SYNC = ChatGPT must assume the repo is unchanged.**

---
## AUTO-SYNC DEFAULT (BINDING)
- If you created/edited any repo file as part of a task, you MUST push to GitHub without being asked:
  - Push a branch (WIP is OK) and provide branch + commit SHA + commit-SHA RAW links for all changed/created files.
- “SYNC STATUS: LOCAL ONLY” is allowed ONLY if you did NOT modify any repo files.

## TEST SCENARIO (HU) (BINDING)
Whenever an agent claims `READY FOR REVIEW`, they MUST include a compact Hungarian test scenario:

- Teszt célja (1 sor)
- Lépések (3–7 bullet)
- Elvárt eredmény (1–3 bullet)
- Gyors PASS/FAIL kritérium (1 sor)

If no test surface exists: write “N/A (no runtime impact)” + 1-line reason.

## IDEA INTAKE & TRIAGE (BINDING)
When Ádám proposes a new idea, the receiving agent MUST:
1) Classify urgency: NOW | SOON | LATER
2) Assess impact: S | M | L
3) Ask up to 5 clarifying questions (only what is needed)
4) Record it:
   - NOW → must be added to docs/STATUS_WALKTHROUGH.md ## NOW (push to main)
   - SOON/LATER → add to docs/IDEA_LOG.md with suggested release + dependencies
5) If “will definitely be needed later”: add a “Forward-compat constraint” so current work avoids rework.

## BINDING: NO FORCE PUSH
Direct pushes to `main` are allowed ONLY for document updates by trusted agents.
**FORCE PUSH TO MAIN IS STRICTLY FORBIDDEN.**
All significant changes must come via Pull Request merge.
Recurrence of missing files due to overwrite will result in immediate revocation of direct push privileges.

## CHANGE BROADCAST (BINDING)
Every agent reply must include a 1–3 bullet broadcast:
- What changed (files / decisions)
- What is waiting on whom
- What to test (if READY FOR REVIEW)

---
## Versioning & Rollback (Binding)
- **Policy**: [VERSIONING_ROLLBACK.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/VERSIONING_ROLLBACK.md)
- **Live UI**: [play.asterobia.com](https://play.asterobia.com)
- **Mailbox Rule**: The Mailbox is for **agent-to-agent info sync** only. All strategy decisions & instructions flow via Ádám.

---

## Release System (Binding)
- **Rules**: [RELEASE_SYSTEM.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/RELEASE_SYSTEM.md)
- **Plan**: [RELEASE_PLAN.md](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/RELEASE_PLAN.md) (10+ Step-by-step milestones)
- **Registry**: [public/versions.json](https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/public/versions.json)
- **Rule**: All agents must follow this; mailbox is info sync only.

---

## Where to find everything (absolute links)

> If a raw link shows 404 or fails to load: hard refresh (Ctrl+F5) or add `?nocache=1` to the URL.
> If raw view is restricted in your environment, open the same path in GitHub UI (`github.com/.../blob/...`) instead.
> Canonical Sources Index includes an "Absolute Raw Links" section for raw-view compatibility.

### Canonical “stable index”
- https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/baseline/pre-claude-stable/docs/CANONICAL_SOURCES_INDEX.md

### Live status (what is happening now)
- https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/STATUS_WALKTHROUGH.md
- **Reality Spec**: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/CURRENT_SYSTEM_SPEC.md
- **Bugbook**: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/BUGBOOK.md
- **Idea Log**: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/IDEA_LOG.md
- **ChatGPT Opening Pack**: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/CHATGPT_OPENING_PACK.md

### Cross-agent requests / waiting items
- https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/MAILBOX.md

### Agent notes
- Claude: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/NOTES_CLAUDE.md
- Antigravity: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/NOTES_ANTIGRAVITY.md
- ChatGPT: https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/NOTES_CHATGPT.md

### Verification gates
- https://raw.githubusercontent.com/lendvaiadam/asterobia-quality-docs/main/docs/IMPLEMENTATION_GATES.md

---

## How to resume in a NEW chat window (2 minutes)
1) Open this file (START_HERE).
2) Open CHATGPT_OPENING_PACK.md and paste the COPY/PASTE block.
3) Open STATUS_WALKTHROUGH + MAILBOX.
3) Open your agent NOTES file.
4) Continue from the top “NOW” task and report blockers via Ádám.
