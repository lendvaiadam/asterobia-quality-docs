# MAILBOX - AI Coordination Bus (NO HUMAN READING)

**Purpose**: Asynchronous message bus for AI Agents (Orchestrator <-> Worker).
**Rule**: Humans do NOT monitor this. Agents must use `[ROUTING]` blocks in chat to trigger Human action.

## Protocol
Append a new entry when a Work Order is ready for Integration or Escalation.

**Format:**
`[Date] [WO-XXX] [Worker] [Branch] [PASS/FAIL] [Note]`

## Escalation Inbox (High Priority)
Post mid-flight blocking issues here. Antigravity monitors this.

**Format:** `[ESCALATION] [WO-XXX] [Worker] [Reason]`
**Decision Format:** `[DECISION] [APPROVE/REJECT/MODIFY] [Instruction]`

## Completion Inbox (Routine)

<!-- Worker Entries Below -->
