# START HERE — Asterobia Control Entry Point (Stable)
This file is the single entrypoint link you can give to any AI (ChatGPT, Antigravity Gemini, Claude, Claude Code).
It contains stable rules, roles, and pointers to where everything lives.

---

## What this project is
Astrobia/Asterobia is a strategy/simulation game project.
Current engineering priority: Refactor toward Phase 0 “Netcode Readiness” (host-authoritative, deterministic, backend-ready).

---

## Roles (who does what)

### Ádám (Human Owner / Router)
- Proposes ideas in Hungarian.
- Reads HU impact/consequence notes and decides priorities/scope.
- Relays English prompts between AIs (copy/paste).
- Executes HU test scenarios and reports results in Hungarian.
- Approves acceptance decisions (PASS/FAIL); agents perform merges after explicit approval.

### Antigravity (Gemini) — Auditor & Snapshot Operator
- Audits, repo mapping, risk registers, documentation snapshots, link indexing, preflight checks.
- Docs operator (creates/edits markdown files) unless explicitly stated otherwise.

### Claude / Claude Code — Implementer
- Implements code changes in small PRs strictly following binding canonical specs.
- Keeps game playable after each PR.
- May update its own notes file after PRs.

### ChatGPT — Spec Guardian & Prompt Writer
- Produces prompts for Claude and Antigravity.
- Read-only on GitHub; requests doc edits via Antigravity using exact patches.

---

## CHATGPT OPENING PACK (BINDING)

- The canonical, self-updating opening message + RAW link library lives in:
  https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/CHATGPT_OPENING_PACK.md

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

## Fresh Session Bootstrap (BINDING)
> **On a fresh session:** DO NOT ask questions. First read the Required Reading Set below. Then open `docs/STATUS_WALKTHROUGH.md` and execute **## NOW**. Ask only if a required link/input is missing.

### Required Reading Set (BINDING)
1) `docs/STATUS_WALKTHROUGH.md` (execute ## NOW after reading)
2) `docs/IMPLEMENTATION_GATES.md`
3) `docs/CANONICAL_SOURCES_INDEX.md` (use the “Absolute Raw Links” section if raw-view breaks relative links)

### Canonical Spec Sources (BINDING)
You MUST read these binding specs from `publish/quality_docs_snapshot_2026-01-14/spec_sources/`:
- `ASTROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md`
- `ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md`
- `ASTROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md`
- `ASTROBIA_CANONICAL_VISION_MAX_SOURCES_POLICY_2026-01-13.md`
- All 8 Feature Specs:
  - `ASTROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md`
  - `ASTROBIA_CANONICAL_FEATURE_WPN_SHOOT_2026-01-13.md`
  - `ASTROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION_2026-01-13.md`
  - `ASTROBIA_CANONICAL_FEATURE_PERCEPTION_SUBSURFACE_SCAN_2026-01-13.md`
  - `ASTROBIA_CANONICAL_FEATURE_MATERA_MINING_2026-01-13.md`
  - `ASTROBIA_CANONICAL_FEATURE_MATERA_TRANSPORT_2026-01-13.md`
  - `ASTROBIA_CANONICAL_FEATURE_TERRAIN_SHAPING_2026-01-13.md`
  - `ASTROBIA_CANONICAL_FEATURE_UNIT_CARRIER_2026-01-13.md`

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
- Agents communicate through Ádám (copy/paste relay).
- Canonical docs are binding. If anything conflicts: Canonical > Audit notes > Chat.
- Implementation is done as small PR branches (prX-...). The responsible agent merges to main after Ádám explicit approval (PASS).
- **Mailbox Restriction**: MAILBOX is agent-to-agent output sync only. Never instruct Ádám to read it. Delivery of prompts/info to other agents must happen via Ádám in chat (paste-ready), with rationale.
- **Planning Protocol (Binding)**: [docs/PLANNING_PROTOCOL.md](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/PLANNING_PROTOCOL.md). All implementation work must follow this.
- **Fresh session rule (binding)**: Open [docs/STATUS_WALKTHROUGH.md](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/STATUS_WALKTHROUGH.md) and follow the **## NOW** section before asking any questions.
- **Spec Update Rule**: After any Release is completed and verified: update [CURRENT_SYSTEM_SPEC](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/CURRENT_SYSTEM_SPEC.md) with what changed.
- **Bugbook Rule**: When a recurring issue is discovered/fixed twice: add it to [BUGBOOK](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/BUGBOOK.md).

---
## SYNC & VISIBILITY (BINDING)

If you work locally, ChatGPT cannot see your changes until you SYNC them.

**SYNC is mandatory** before claiming a task/step is done. SYNC means EITHER:

**A) GitHub Sync (preferred)**
- Push your branch (WIP is OK) and provide:
  - branch name
  - commit SHA
  - RAW links that include the commit SHA for every changed/created file you want ChatGPT to read

**B) Chat Sync Pack (fallback, if you cannot push)**
Paste into the chat:
- `git status`
- `git diff --stat`
- full `git diff`

**No SYNC = ChatGPT must assume the repo is unchanged.**

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

## CHANGE BROADCAST (BINDING)
Every agent reply must include a 1–3 bullet broadcast:
- What changed (files / decisions)
- What is waiting on whom
- What to test (if READY FOR REVIEW)

---
## Versioning & Rollback (Binding)
- **Policy**: [VERSIONING_ROLLBACK.md](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/VERSIONING_ROLLBACK.md)
- **Live UI**: [play.asterobia.com](https://play.asterobia.com)
- **Mailbox Rule**: The Mailbox is for **agent-to-agent info sync** only. All strategy decisions & instructions flow via Ádám.

---

## Release System (Binding)
- **Rules**: [RELEASE_SYSTEM.md](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/RELEASE_SYSTEM.md)
- **Plan**: [RELEASE_PLAN.md](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/RELEASE_PLAN.md) (10+ Step-by-step milestones)
- **Registry**: [public/versions.json](https://raw.githubusercontent.com/lendvaiadam/asterobia/main/public/versions.json)
- **Rule**: All agents must follow this; mailbox is info sync only.

---

## Where to find everything (absolute links)

> If a raw link shows 404 or fails to load: hard refresh (Ctrl+F5) or add `?nocache=1` to the URL.
> If raw view is restricted in your environment, open the same path in GitHub UI (`github.com/.../blob/...`) instead.
> Canonical Sources Index includes an "Absolute Raw Links" section for raw-view compatibility.

### Canonical “stable index”
- https://raw.githubusercontent.com/lendvaiadam/asterobia/baseline/pre-claude-stable/docs/CANONICAL_SOURCES_INDEX.md

### Live status (what is happening now)
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/STATUS_WALKTHROUGH.md
- **Reality Spec**: https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/CURRENT_SYSTEM_SPEC.md
- **Bugbook**: https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/BUGBOOK.md
- **Idea Log**: https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/IDEA_LOG.md
- **ChatGPT Opening Pack**: https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/CHATGPT_OPENING_PACK.md

### Cross-agent requests / waiting items
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/MAILBOX.md

### Agent notes
- Claude: https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/NOTES_CLAUDE.md
- Antigravity: https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/NOTES_ANTIGRAVITY.md
- ChatGPT: https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/NOTES_CHATGPT.md

### Verification gates
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/IMPLEMENTATION_GATES.md

---

## How to resume in a NEW chat window (2 minutes)
1) Open this file (START_HERE).
2) Open CHATGPT_OPENING_PACK.md and paste the COPY/PASTE block.
3) Open STATUS_WALKTHROUGH + MAILBOX.
3) Open your agent NOTES file.
4) Continue from the top “NOW” task and report blockers via Ádám.
