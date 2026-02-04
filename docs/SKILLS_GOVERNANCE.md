# SKILLS GOVERNANCE & INDEX

**Purpose**: Defines the library of Claude "Skills", how they are assigned, and how they are updated.
**Binding**: Orchestrators MUST select skills from this index. Workers MUST NOT use unapproved skills.

---

## 1. Skills Index (Canonical)

| Role | Skill ID | Description | When to Assign |
| :--- | :--- | :--- | :--- |
| **All** | `skill-core-git` | Git ops, branching. | Always. |
| **Backend** | `skill-supabase` | Supabase SDK, SQL, Edge Functions. | DB/Auth tasks. |
| **Backend** | `skill-net-webrtc` | PeerJS, Signaling logic. | Multiplayer Networking. |
| **Frontend** | `skill-threejs` | Three.js implementation. | 3D Graphics tasks. |
| **Frontend** | `skill-ui-vanilla` | Web Components, CSS. | UI tasks. |
| **QA** | `skill-test-jest` | Jest/Node testing patterns. | Verification tasks. |
| **Refactor** | `skill-docs-sync` | Markdown formatting, linting. | Documentation updates. |

---

## 2. Skill Assignment Protocol

**Orchestrator Responsibility**:
1. **Analyze** Work Order requirements.
2. **Select** subset of `Skill IDs` from Index.
3. **Include** selection in the Work Order Routing Block.

**Example**:
> "You are Worker (BE). Load Skills: `skill-core-git`, `skill-supabase`."

---

## 3. Skill Update Protocol

**Triggers**:
- New Tech Stack (e.g. adding a Physics Engine).
- Repeated Worker Failure (Skill definition is poor).
- Deprecation (Old tool removed).

**Workflow**:
1. **Propose (Orchestrator)**: "I need a skill for `[Topic]`. Proposing `skill-new-topic`."
2. **Review (Antigravity)**: Audits the proposal for security/determinism.
3. **Install (Antigravity)**: Adds prompt/docs to `docs/skills/`.
4. **Register (Antigravity)**: Updates **Skills Index** above.
