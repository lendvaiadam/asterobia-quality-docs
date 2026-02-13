# ARCHITECTURAL PRINCIPLE: Multi-Client / Renderer Separation

**Status:** ACTIVE (Mandatory for Phase 3+)
**Date:** 2026-02-13
**Version:** 1.0

## 1. The Core Principle
Asterobia is a **Separable System**. The "Game" is defined solely by the authoritative server logic and the platform-neutral simulation core, NOT by the visual renderer.

**The Golden Rule:**
> **The Renderer is NEVER Authoritative.**
> It consumes state (Snapshots) and emits intent (Inputs). It contains NO game rules, NO physics logic, and NO inventory math that isn't purely for prediction/cosmetic feedback.

## 2. Architecture Layers

### A. The Core (Platform-Neutral)
*Must run in Node.js (Server), Browser (Worker), and potentially C++ (Future Backend).*
*   **simulation/**: Math, State Machines, RNG.
*   **netcode/**: Protocol, Snapshots, Interpolation Buffer.
*   **logic/**: Inventory, Crafting, Stats.
*   **Constraint:** NO dependence on `window`, `document`, `WebGL`, `THREE`, or DOM APIs.

### B. The Shell (Platform-Specific)
*The "glue" that connects the user to the Core.*
*   **Web Shell:** `index.html`, `Main.js` (bootstrapper).
*   **Desktop Shell (Future):** Electron/Tauri wrapper.
*   **Native Shell (Future):** C++/Rust entry point.

### C. The Renderer (Interchangeable)
*The visual representation of the state.*
*   **Current:** `THREE.js` (Browser/WebGL).
*   **Future:** Possible native renderer (Vulkan/Metal) or alternative engine.
*   **Constraint:** The Core sends data to the Renderer (via clean interfaces/events). The Renderer NEVER modifies the Core state directly.

## 3. Migration Path

1.  **Phase 2/3 (Current): Web Monolith**
    *   Code is split into `src/Core` (mixed) and `server/` (pure).
    *   *Action:* Refactor `src/Core` to isolate pure logic from `THREE` dependencies.

2.  **Phase 4: Desktop Package**
    *   Wrap the Web App in Electron/Tauri.
    *   *Benefit:* Steam distribution, raw socket access, better file I/O.
    *   * Requirement:* The "Server" logic must run as a child process or background thread, independent of the UI thread.

3.  **Phase X: Native Consumer**
    *   The Core runs as a library/DLL.
    *   A completely new Native Client connects to it (or the remote server).
    *   *Proof of Success:* The Native Client plays the exact same game without rewriting a single line of game rule code.

## 4. Guardrails for Development
*   **Avoid:** `import * as THREE` in any file inside `simulation/` or `netcode/`.
*   **Use:** Adapters or Events for audio/visuals. (e.g., `eventBus.emit('EXPLOSION', {pos})` instead of `playSound('boom.mp3')`).
*   **Test:** Logic tests must run in Node.js without a browser environment (headless).
