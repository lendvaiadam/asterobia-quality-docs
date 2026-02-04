> ⚠️ DEPRECATED (NON-BINDING). This document is superseded by docs/AI_WORKFLOW.md.
> If any conflict exists, AI_WORKFLOW.md wins.

# PLANNING PROTOCOL (Deprecated)

## A. Purpose (Binding)
- **Prevent build-then-teardown**: All changes must align with long-term goals.
- **Enforce Netcode Readiness**: Every change must respect determinism and authority/render separation.
- **Minimal Invasive**: Prefer shims and small integrations over deep refactors unless essential.

## B. Roles (Binding)
- **ChatGPT**: **Spec Guardian & Prompt Writer**. Synthesizes plans, drives iteration, producing the final "Decision Packet" for Ádám.
- **Antigravity**: **Repo Operator / Quality**. Reviews plans, enforces gates, creates releases, manages the repo state.
- **Claude Code**: **Coder-of-Record**. Authors implementation plans, writes the code, delivers PRs for review.
- **Ádám**: **Decision-Maker & Tester**. Forwards messages, approves decisions, runs tests.

## C. DOC-ANSWER GATE (BINDING)
Before any plan OR before any blocking question, the agent MUST:
1) Paste “Sources Read (RAW links)” of what was actually opened.
2) Paste “Doc Search Performed” (where it searched + keywords).
3) Only if still unresolved: create/append an “OPEN DECISIONS” entry in STATUS_WALKTHROUGH with:
   - Decision ID
   - Options (A/B/…)
   - Recommended default + rationale
   - Impact (S/M/L)
   - Who decides (Ádám)
- Prohibit asking for decisions already specified in RELEASE_PLAN unless proposing a change (then must cite the existing rule).

## D. Planning Steps (Binding)

### Step 1 — ChatGPT Sprint Proposal
State:
- Objective & Scope
- Success Criteria & Constraints
- Candidate Files

### Step 2 — Antigravity Review (Round 1)
Identify:
- Risks & Netcode Constraints (determinism, state surface)
- Minimal-Invasive Plan Options
- Affected Files & Alternatives

### Step 3 — Iterative Consultation (REQUIRED if >1 option)
- **ChatGPT** asks focused follow-ups.
- **Antigravity** provides concrete options/tradeoffs.
- **Repeat** until a "Preferred Plan" is selected or escalated.
- **Output**: "Preferred Plan" or "Escalation to Ádám".

### Step 4 — Claude Review
Assess:
- Implementation feasibility
- Smallest PR decomposition
- Edge cases & "Gotchas"
- Test/Guardrail inclusions

### Step 5 — Decision Packet (Synthesis)
ChatGPT produces for Ádám:
- 1–3 Decision Questions (max)
- Short Rationale
- Expected User-Visible Changes
- Minimal Test Scenario

### Step 6 — Implementation (After Approval)
**Claude** executes:
- Small PRs only.
- Minimal Touch.
- Returns: Changelog, Risks, Commit Hash, Test Script.

### Step 7 — Completion
**Antigravity** finalizes:
- Updates Docs (Status/Decision Log).
- Commit & Push.
- Returns: Commit Hash + Raw Links.

## D. Communication Rules (Binding)
- **NO Mailbox Instructions**: Mailbox is for info sync only.
- **Prompts**: Must be delivered to Ádám in chat (paste-ready) with context.
- **File Referencing**: ALWAYS name the exact file path.

## E. Output Requirements (Binding)
For any completed work:
1.  **Commit Hash**.
2.  **Raw Links** to changed files.
3.  **Release Suggested?** (YES/NO + Reason).
4.  **Minimal Test Script** (if behavior changed).

## F. Stop Conditions (Binding)
**PAUSE** and ask Ádám if:
- Spec Ambiguity / Conflict (Order: Canonical > Audit > Chat).
- Approach becomes invasive or hard to revert.
- Netcode/Determinism risk detected.
- Unclear ownership boundaries (Authority vs Render).
