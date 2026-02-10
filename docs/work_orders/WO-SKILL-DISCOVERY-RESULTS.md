# WORKER SKILL PROPOSALS (Consolidated)

**Source**: Worker Discovery Session
**Status**: Pending Antigravity Review

---

## === BACKEND (BE) ===

### Skill 1: `skill-supabase-realtime`
**Scope**: Supabase Realtime channel operations - joinChannel, broadcast, presence, subscriptions
**Constraints**:
- Must NOT modify RLS policies directly
- Must NOT use service_role key
- Must NOT bypass ITransport abstraction
**When to Use**:
- Implementing lobby discovery (M04-M05)
- Session channel messaging (M06+)
- Any multiplayer broadcast feature
**Example**:
- `joinChannel('asterobia:lobby', callback)` for host discovery
- `broadcastToChannel(channelName, msg)` for HOST_ANNOUNCE
- Presence tracking for player online status

### Skill 2: `skill-supabase-rls`
**Scope**: Row-Level Security policy design and verification for Supabase tables
**Constraints**:
- Must NOT disable RLS on any table
- Must NOT grant public access without explicit approval
- Must NOT use service_role for client operations
**When to Use**:
- Creating new database tables (sessions, command_log)
- Auditing security of existing policies
- Debugging "permission denied" errors
**Example**:
- SELECT policy: `auth.uid() = host_id OR is_public = true`
- INSERT policy: `auth.uid() = host_id`
- CI grep check for `sbp_` patterns in source

### Skill 3: `skill-supabase-schema`
**Scope**: Database schema design - tables, indexes, migrations, foreign keys
**Constraints**:
- Must NOT drop tables without migration path
- Must NOT add columns that break existing serialization
- Must use versioned migrations
**When to Use**:
- N05: sessions table for persistent lobby
- N06: command_log table for resync
- Any new persistence feature
**Example**:
- Create sessions table with `host_id`, `is_active`, `last_heartbeat`
- Add index on `(is_active, last_heartbeat)` for lobby queries
- Add `world_state_id` FK to existing `world_states` table

### Skill 4: `skill-transport-abstraction`
**Scope**: ITransport interface compliance - ensuring all network code flows through transport layer
**Constraints**:
- Must NOT bypass InputFactory → Transport → CommandQueue flow
- Must NOT use raw WebSocket/fetch for game commands
- Must NOT add transport-specific code to SimCore
**When to Use**:
- Any new network message type
- Adding alternative transports (WebRTC, PeerJS)
- Auditing for transport bypass violations
**Example**:
- All `INPUT_CMD` flows through `transport.send()`
- Guest inputs never mutate local state directly
- `SNAPSHOT` receive goes through `transport.onReceive` callback

---

## === FRONTEND (FE) ===

### Skill 5: `skill-input-system`
**Scope**: Keyboard/mouse/gamepad capture, input buffering, keybind configuration, input-to-command mapping
**Constraints**:
- Must NOT directly mutate SimCore state (input flows through InputFactory only)
- Must NOT handle network serialization (that's transport layer)
- Must NOT create UI elements (delegate to skill-ui-vanilla)
**When to Use**: Input rebinding features, new control schemes, input replay/recording, accessibility options
**Example**:
- Implementing WASD camera controls
- Adding gamepad support for unit selection
- Building an input recording system for determinism tests

### Skill 6: `skill-render-interpolation`
**Scope**: Visual smoothing between simulation ticks, client-side prediction display, lag compensation visuals
**Constraints**:
- Must NOT modify authoritative SimCore state (visual-only)
- Must NOT change tick rate or simulation timing
- Must NOT implement network prediction logic (that's Backend/transport)
**When to Use**: Multiplayer visual polish, 60fps rendering from lower tick rates, smooth unit movement display
**Example**:
- Interpolating unit positions between 20Hz sim ticks for 60fps display
- Ghost/prediction rendering for local player actions
- Smooth camera following during network latency

### Skill 7: `skill-hud-overlay`
**Scope**: In-game HUD layers, resource displays, minimap, selection indicators, tooltips, floating health bars
**Constraints**:
- Must NOT handle menu/modal UI (that's skill-ui-vanilla)
- Must NOT directly query game state (receives data via events/props)
- Must NOT implement game logic in HUD code
**When to Use**: Adding new HUD elements, minimap features, unit selection feedback, resource counters
**Example**:
- Building a minimap with fog-of-war display
- Floating damage numbers above units
- Selection box rectangle rendering

### Skill 8: `skill-shader-effects`
**Scope**: Custom GLSL shaders, post-processing effects, material authoring, GPU-based visual effects
**Constraints**:
- Must NOT affect simulation determinism (visual-only)
- Must NOT modify Three.js core (use shader injection points)
- Must NOT implement compute shaders for game logic
**When to Use**: Visual effects (explosions, shields), custom materials, post-processing (bloom, fog)
**Example**:
- Writing a shield bubble shader with fresnel effect
- Adding bloom post-processing to lasers
- Custom asteroid material with procedural detail

---

## === QA ===

### Skill 9: `skill-qa-determinism`
**Scope**: Dual-run verification, hash comparison, tick-by-tick state matching for SimCore
**Constraints**:
- NO modifying simulation logic (SimLoop, CommandQueue, etc.)
- NO creating non-deterministic tests (Date.now(), Math.random())
- Tests MUST use SeededRNG and synthetic time
**When to Use**: Any SimCore change affecting state evolution, pathfinding, or command processing
**Example**:
- Write dual-run test verifying new MOVE command produces identical hashes
- Add stress test for new seed values
- Verify 100% tick-match rate after transport changes

### Skill 10: `skill-qa-unit-jest`
**Scope**: Jest/Vitest unit test patterns, mocking, assertion helpers
**Constraints**:
- NO integration tests spanning multiple modules
- NO browser-dependent tests (use headless patterns)
- Mocks MUST be isolated to test file scope
**When to Use**: New module creation, bug fix verification, API contract testing
**Example**:
- Mock SupabaseTransport for SessionManager tests
- Test InputFactory command generation in isolation
- Verify edge cases (null inputs, empty arrays)

### Skill 11: `skill-qa-e2e-playwright`
**Scope**: Playwright browser automation for full UI/game flow testing
**Constraints**:
- NO testing SimCore logic (use determinism skill instead)
- NO tests that bypass InputFactory (must use real UI interactions)
- Tests MUST be idempotent (same result on re-run)
**When to Use**: UI component changes, lobby flow, multiplayer handshake validation
**Example**:
- Automate "Host Game" → "Guest Join" flow
- Verify lobby list renders correctly
- Screenshot regression for UI components

### Skill 12: `skill-qa-hu-scenarios`
**Scope**: Writing Hungarian-language manual test scenarios for Ádám
**Constraints**:
- NO writing automated tests (manual scenarios ONLY)
- Scenarios MUST follow existing HU-TEST format (Pre/Step/Expected)
- NO English-only scenarios (Hungarian required for operator)
**When to Use**: UI/UX changes, gameplay feature completion, pre-merge human verification
**Example**:
- Write HU scenario for new lobby join button
- Document expected behavior for network disconnect
- Create Pre/Step/Expected checklist for save/load cycle

---

## === REFACTOR (RF) ===

### Skill 13: `skill-cleanup-deadcode`
**Scope**: Identify and remove unused code artifacts — orphaned files (*_old.js, *_backup.js), unreferenced exports, dead functions, commented-out code blocks.
**Constraints**:
- MUST verify zero references before removal (grep/search confirmation)
- MUST NOT remove code that is conditionally loaded or feature-flagged
- MUST NOT remove test fixtures or mocks without QA review
- MUST preserve git history (no squashing unless requested)
**When to Use**:
- Post-feature cleanup (after WO marked complete)
- Tech debt sprints
- Pre-release hygiene pass
**Example**:
- Remove `src/Core/Game_old.js` after confirming no imports reference it
- Delete `*_restore_0332.js` backup files after version is stable
- Remove commented `// TODO: delete this` blocks older than 2 releases

### Skill 14: `skill-lint-autofix`
**Scope**: Run and apply ESLint/Prettier auto-fixes for formatting, whitespace, trailing commas, semicolons, and other style rules that do NOT affect runtime behavior.
**Constraints**:
- MUST only apply `--fix` rules that are purely stylistic
- MUST NOT apply fixes that change logic (e.g., no `no-unused-vars` auto-delete)
- MUST run tests after fixes to confirm no regression
- MUST NOT modify eslint config without CTO approval
**When to Use**:
- Pre-commit cleanup (before `git add`)
- After merging multiple worker branches (style normalization)
- When linter is red on CI
**Example**:
- `npx eslint src/ --fix` for formatting
- Fix trailing whitespace and missing semicolons
- Normalize quote style (single vs double)

### Skill 15: `skill-review-imports`
**Scope**: Audit and clean up import/export structure — find circular dependencies, consolidate barrel exports, verify path consistency (relative vs absolute).
**Constraints**:
- MUST NOT change module behavior or public API surface
- MUST NOT introduce new dependencies
- MUST flag circular dependencies for Orchestrator decision (not auto-fix)
- MUST preserve existing index.js barrel patterns
**When to Use**:
- Architecture review requests
- After major refactor merges
- When build/bundle errors appear
**Example**:
- Consolidate scattered `import { X } from '../runtime/X.js'` to `import { X } from '../runtime/index.js'`
- Flag circular dep: `A.js → B.js → A.js` for escalation
- Verify all `src/SimCore/` imports use consistent relative paths
