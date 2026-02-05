# ROUTING_PACKET_M06 (Operator Packet)

Purpose: Store long instructions that exceed chat input limits. Orchestrator must read this file before acting.

## CURRENT INCIDENT

- M05 regression detected: `typeof game.sessionManager.startDiscovery === 'undefined'` and `getAvailableHosts === 'undefined'` (API surface missing).
- Block M06 work until M05 discovery API is restored.

## REQUIRED NEXT ACTIONS (ordered)

1) **Fix M05 regression**: restore `startDiscovery()`, `stopDiscovery()`, `getAvailableHosts()` as functions on SessionManager prototype (idempotent; no channel leak).
2) **Add an API-surface check to HU-TEST M06**: fail fast if discovery methods are missing.
3) **Root-cause**: document which merge/resolve overwrote the M05 API and add a workflow guard to prevent it (e.g., "API Surface Gate" checklist item).

## BLOCKING RULE

- Do NOT proceed to "Fix M06 stub / real JOIN_REQ/ACK" until the M05 API regression is fixed.
- M06 closure is BLOCKED until M05 API is verified at runtime.

---

*Created: 2026-02-05*
*Author: Orchestrator (via Antigravity directive)*
