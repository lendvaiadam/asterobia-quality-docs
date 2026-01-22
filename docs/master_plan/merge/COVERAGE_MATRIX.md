# COVERAGE MATRIX: Release 000 Master Plan Merge

**Date:** 2026-01-22
**Inputs:**
- [Claude Master Plan](../../Claude/master_plan/MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md) (v1)
- [Antigravity Master Plan](../../Antigravity/Release000_MasterPlan/BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md) (v3)

| Topic | Claude Coverage | Antigravity Coverage | Gap / Missing | Conflict / Delta | Decision Req? |
|-------|-----------------|----------------------|---------------|------------------|---------------|
| **Multiplayer Internet Stack** | Appx A (Interface, WebRTC details, ICE config, Supabase signaling) | Appx A (SimLoop implementation, Mulberry32 code, StateRegistry interface) | None. Together they are comprehensive. | Claude: 10-20Hz snapshot rate. AG: 20Hz strict. | No (20Hz is standard) |
| **Backend / Services** | Appx B (Supabase DB schema, Auth, RLS) + Plan Sec 6 | Appx B (Schema but less detailed in viewed file, references Appendices) | AG schema details viewed were summary only; Claude has SQL. | None. Both choose Supabase + PeerJS. | No |
| **Persistence / Snapshots / Replay** | Sec 6.3 (JSON format, LocalStorage), Sec 6.4 (Migration) | Appx A (StateRegistry split, Serializer concept) | **Replay System** missing in both (mentioned as future Anti-Cheat but no spec). | Claude: Delta compression (Diff). AG: Full snapshots for v1. | **YES: Snapshot Strategy** |
| **Determinism Strategy** | Sec 4.5 (Timestep, RNG, IDs, Floats, Sorting) | Appx A (Mulberry32 code, SimLoop accumulator code) | Float determinism specifics (e.g. math lib?) missing in both beyond "standard". | None. Approaches match. | No |
| **SimCore vs View Boundaries** | Sec 4.2 (Arch Diagram) + Appx E (PRs) | Sec 3 (Layer definitions) + Appx A (Input processing) | Concrete **Folder Structure** for strict separation (SimCore vs Core vs View). | None. Both decouple Sim from View. | No |
| **GRFDTRDPU Implementation** | Sec 7 (Pipeline overview, Module mapping) | Appx C (Mentioned in TOC, file not viewed but listed in dir) | Detailed **UI Mockup** / Data flow for Designer <-> Factory missing. | None visible. | No |
| **Feature Dependency Graph** | Sec 8.1 (ASCII Art) + Appx D (Ref) | Appx D (Mentioned in TOC) | **Visual rendering** of graph (Mermaid) needed for clear verification. | None. | No |
| **UI/UX Pipeline** | Sec 7.3 (Designer UI mentions) | Sec 5.1 (Designer flow) | **Specific Tech Stack** for UI (Vanilla DOM? Canvas? Overlay?). | None. | **YES: UI Tech Stack** |
| **Testing / CI / Observability** | Appx F (Ref) + Sec 2.4 (Checklist) | Appx F (Ref) + Appx A (Desync detection) | **CI Config** (GitHub Actions yaml) specifics. | None. | No |
| **Risk Register** | Sec 11 (Ref) | Appx G (Ref) | **Mitigation Code** snippets for specific risks (e.g. NAT fail). | None. | No |
| **Release / Sprint / PR Execution** | Appx E (Detailed PR list, broken down by file/lines) | Appx E (Detailed WBS, PR list) | **Sprint 0** Setup details (repo config, linter, husky). | Claude: 25 releases. AG: 25 releases. Aligning numbers. | No |

## Analysis Summary

*   **Complementary Strengths:**
    *   **Claude:** Strong on **Execution Details** (PR breakdown, file paths, precise SQL schemas, detailed class interfaces).
    *   **Antigravity:** Strong on **Architecture Fundamentals** (SimLoop code, Transport/State separation philosophy, RNG implementation).
*   **Merge Strategy:**
    *   Use **Antigravity's Architecture definitions** (SimLoop, StateRegistry, Transport Interface) as the *Core*.
    *   Use **Claude's PR/Release Breakdown** as the *Execution Plan* (it's more granular/file-specific).
    *   Use **Claude's Supabase Schema** as the *Backend Spec*.
    *   Use **Antigravity's Feature logic** for the SimCore modules.

## Top Gaps
1.  **Replay System:** Neither plan fully specs how replays are saved/loaded/verified.
2.  **UI Tech Stack:** "Designer UI" is mentioned but no decision on library/method (Vanilla HTML vs React vs Canvas).
3.  **CI/CD:** No concrete GitHub Actions workflow defined.
