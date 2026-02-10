/**
 * UnitTypeBinder.js
 * 
 * Binds UnitModels to TypeBlueprints and applies computed stats.
 * Part of the Production Stub (Prompt 06).
 */

import { getBlueprint } from './BlueprintStorage.js';
import { StatsEngine } from '../rules/StatsEngine.js';
import { loadStatsConfig } from './StatsConfigStorage.js';

// Active bindings: Map<unitId, BindingRecord>
const activeBindings = new Map();

// Lazy-initialized stats engine
let statsEngine = null;

function getStatsEngine() {
    if (!statsEngine) {
        const config = loadStatsConfig();
        statsEngine = new StatsEngine(config);
    }
    return statsEngine;
}

/**
 * Binding record structure
 * @typedef {Object} BindingRecord
 * @property {string} unitId
 * @property {string} blueprintId
 * @property {string} typeName
 * @property {number} boundAt - timestamp
 * @property {Object} computedStats - snapshot of stats at bind time
 */

/**
 * Bind a UnitModel to a TypeBlueprint.
 * Computes stats and applies movement speed immediately.
 *
 * @param {UnitModel} unitModel - The unit model to bind
 * @param {string} blueprintId - The blueprint ID to bind to
 * @param {number} [tick=0] - Simulation tick for deterministic timestamps
 * @returns {BindingRecord|null} The binding record, or null if blueprint not found
 */
export function bindUnitToBlueprint(unitModel, blueprintId, tick = 0) {
    const blueprint = getBlueprint(blueprintId);
    if (!blueprint) {
        console.warn(`[UnitTypeBinder] Blueprint not found: ${blueprintId}`);
        return null;
    }

    // Compute stats using StatsEngine
    const featureCount = Object.keys(blueprint.allocations).filter(k => blueprint.allocations[k] > 0).length;
    const unitData = {
        typeAllocation: blueprint.allocations,
        featureCount: featureCount,
        featureTraining: {},
        unitTraining: 1.0,
        tunedFeature: null,
        amortization: 1.0,
        damage: {}
    };
    const computedStats = getStatsEngine().computeAllStats(unitData);

    // Apply to UnitModel
    unitModel.typeId = blueprintId;
    unitModel.speed = computedStats.move;
    unitModel.effectiveStats = {
        move: computedStats.move,
        vision: computedStats.vision,
        shot: computedStats.shot,
        shield: computedStats.shield
    };

    // Create binding record
    const binding = {
        unitId: unitModel.id,
        blueprintId: blueprintId,
        typeName: blueprint.name,
        boundAt: tick || 0,
        computedStats: { ...computedStats }
    };

    // Store binding
    activeBindings.set(unitModel.id, binding);

    console.log(`[UnitTypeBinder] Bound unit ${unitModel.id} to "${blueprint.name}" - speed=${computedStats.move.toFixed(1)}, vision=${computedStats.vision.toFixed(1)}`);

    return binding;
}

/**
 * Rebind a unit to its current blueprint (recompute stats).
 * Useful when blueprint allocations have changed.
 * 
 * @param {UnitModel} unitModel - The unit model to rebind
 * @returns {BindingRecord|null} The updated binding record
 */
export function rebindUnit(unitModel) {
    const binding = activeBindings.get(unitModel.id);
    if (!binding) {
        console.warn(`[UnitTypeBinder] No binding found for unit ${unitModel.id}`);
        return null;
    }

    return bindUnitToBlueprint(unitModel, binding.blueprintId);
}

/**
 * Get the binding info for a unit.
 * 
 * @param {string} unitId - The unit ID
 * @returns {BindingRecord|null} The binding record, or null if not bound
 */
export function getBinding(unitId) {
    return activeBindings.get(unitId) || null;
}

/**
 * Apply movement speed to a UnitModel (low-level).
 * 
 * @param {UnitModel} unitModel - The unit model
 * @param {number} moveSpeed - The movement speed to apply
 */
export function applyMoveSpeed(unitModel, moveSpeed) {
    unitModel.speed = moveSpeed;
    if (unitModel.effectiveStats) {
        unitModel.effectiveStats.move = moveSpeed;
    }
}

/**
 * Check if a unit is bound to a blueprint.
 * 
 * @param {string} unitId - The unit ID
 * @returns {boolean} True if bound
 */
export function isBound(unitId) {
    return activeBindings.has(unitId);
}

/**
 * Unbind a unit from its blueprint.
 * 
 * @param {string} unitId - The unit ID
 * @returns {boolean} True if was bound and now unbound
 */
export function unbindUnit(unitId) {
    return activeBindings.delete(unitId);
}

/**
 * Get all active bindings.
 * 
 * @returns {Map<string, BindingRecord>} All active bindings
 */
export function getAllBindings() {
    return new Map(activeBindings);
}
