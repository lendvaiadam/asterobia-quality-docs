/**
 * SimCore - Engine-Agnostic Simulation Core
 * @environment isomorphic
 *
 * This module contains ALL game logic that can run without a renderer.
 * NO Three.js, WebGL, or rendering dependencies allowed here.
 *
 * PURITY AUDIT (2026-02-10):
 *   - Replaced require() call with ESM re-export of singletons.
 *   - All sub-modules are ESM; safe for Node.js `import`.
 *
 * Architecture:
 * - domain/   : Entity models (UnitModel, TypeBlueprint, Goal, Feature, Command, Action)
 * - rules/    : Stat formulas, costs, modifiers, caps (StatsEngine, CostCalculator)
 * - systems/  : Game systems (Research, Dev, Production, Combat, Economy, Timeline)
 * - runtime/  : Infrastructure (EventBus, Store, TimeSource)
 *
 * Design Goals:
 * 1. Simulation can run headless (server-side for multiplayer)
 * 2. State is serializable (for persistence and sync)
 * 3. All balance knobs are externalized (Dev Panel)
 * 4. Rendering subscribes to state changes via EventBus
 *
 * @module SimCore
 * @version 0.1.0
 */

// Runtime infrastructure
export * from './runtime/index.js';

// Domain models (placeholder)
export * from './domain/index.js';

// Game rules (placeholder)
export * from './rules/index.js';

// Game systems (placeholder)
export * from './systems/index.js';

// Version info
export const SIMCORE_VERSION = '0.1.0';

// ESM import of singletons (replaces former require() call)
import { globalStore, globalEventBus, globalTimeSource } from './runtime/index.js';

/**
 * Initialize SimCore with default configuration.
 * Call this once at game startup.
 *
 * @param {Object} [options] - Configuration options
 * @param {boolean} [options.debug=false] - Enable debug mode
 * @returns {Object} SimCore context with store, eventBus, timeSource
 */
export function initSimCore(options = {}) {
    if (options.debug) {
        globalStore.set('debugMode', true);
        console.log('[SimCore] Initialized in debug mode');
    }

    // Emit init event
    globalEventBus.emit('SIMCORE_INIT', { version: SIMCORE_VERSION });

    return {
        store: globalStore,
        eventBus: globalEventBus,
        timeSource: globalTimeSource
    };
}
