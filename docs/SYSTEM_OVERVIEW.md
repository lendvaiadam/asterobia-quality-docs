# SYSTEM OVERVIEW — The Root Context

> **Version:** 3.0 (Hierarchical AI System)
> **Status:** ACTIVE & BINDING
> **Last Updated:** 2026-02-04

## 1. High-Level Concept
**Asterobia** is an evolutionary Real-Time Strategy (E-RTS) game played on a spherical world.
Units evolve capabilities through the **G-R-F-Tr-D-P-U** pipeline (Goal → Research → Feature → Training → Design → Production → Unit).
The technical core is a **Fixed-Timestep, Host-Authoritative, Deterministic SimCore** that supports multiplayer simulation logic even in single-player mode.

---

## 2. Entry Point Map (Start Here)

### 🧑‍💻 If you are NEW (Onboarding)
1.  **Read this file** (You are here).
2.  **Understand Roles**: Go to `docs/ROLES_AND_AGENTS.md` to see who does what.
3.  **Understand Process**: Go to `docs/AI_WORKFLOW.md` to learn how we build.

### 🛠️ If you are IMPLEMENTING (Claude Code)
1.  **Check Status**: `docs/STATUS_WALKTHROUGH.md` (What is Active?).
2.  **Read The Bible**: `spec_sources/ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md`.
3.  **Follow Workflow**: `docs/AI_WORKFLOW.md`.

### 🔍 If you are AUDITING (Antigravity)
1.  **Check Quality Gates**: `docs/IMPLEMENTATION_GATES.md`.
2.  **Review Logs**: `docs/BUGLIST.md`, `quality/NETCODE_READINESS_AUDIT.md`.
3.  **Inspect Architecture**: `docs/master_plan/final_v2/MASTER_PLAN_FINAL_v2.md`.

---

## 3. Repository Map

| Directory | Purpose | Strict Rule |
| :--- | :--- | :--- |
| `src/SimCore/` | **Authoritative Logic** | 100% Deterministic. No `Math.random`, No `Date.now`. |
| `src/World/` | **Visualization** | Read-Only from SimCore. No gameplay logic. |
| `src/UI/` | **Presentation** | Sends Commands only. Never mutates state. |
| `docs/` | **Documentation** | Single Source of Truth. |
| `spec_sources/` | **Canonical Specs** | Immutable Game Design constraints. |
| `quality/` | **Audit Reports** | Evidence of verification. |

## 4. The Prime Directive
**Preservation of Value & Determinism.**
- We do not delete functionality without migration.
- We do not break replayability (determinism).
- We do not merge untested code.

## 5. System Hierarchy Pointer
This project uses a **Hierarchical AI Development System**:
1.  **Human Owner (Ádám)**: Strategies & Decisions.
2.  **Antigravity (CTO)**: Architecture & Audit.
3.  **Claude Orchestrator**: Planning & Integration.
4.  **Claude Workers**: Execution (Backend, Frontend, QA).

-> **SEE DETAILED ROLES IN `docs/ROLES_AND_AGENTS.md`**
