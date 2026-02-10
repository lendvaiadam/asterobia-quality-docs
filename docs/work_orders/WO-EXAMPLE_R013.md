# WORK ORDER: R013-HandShake-Protocol

**Target Worker**: Backend (Supabase)
**Parent Branch**: `work/R013-multiplayer`
**Worker Branch**: `work/R013-multiplayer-backend`

## 1. Context
We need to implement the Host-Authoritative handshake. This WO covers the Supabase Schema and Signaling logic required to exchange PeerIDs.

## 2. In-Scope Files (Whitelist)
- `src/SimCore/transport/WebRTCTransport.js`
- `src/SimCore/transport/Signaling.js`
- `docs/specs/R013_DB_SCHEMA_OPTIONAL.md`

## 3. Strict Out-of-Scope (Blacklist)
- `src/Main.js`
- `src/SimCore/core/SimLoop.js` (Do not touch the loop)

## 4. Acceptance Criteria ("Done When")
- [ ] `lobbies` table schema created in local dev.
- [ ] Host can generate a `lobby_id` and store it.
- [ ] Client can read `lobby_id` and get Host PeerID.
- [ ] Unit tests for `Signaling.js` pass.
