/**
 * SaveManager - Game State Save/Load Orchestrator
 *
 * R011: Coordinates serialization and persistence of full SimCore state.
 *
 * Responsibilities:
 * - Serialize all determinism-critical state (game, simLoop, RNG, entityId)
 * - Package into versioned save envelope
 * - Persist via StorageAdapter (localStorage by default)
 * - Restore/hydrate SimCore from saved state
 *
 * Usage:
 *   const saveManager = new SaveManager(game, storageAdapter);
 *   saveManager.save('slot1');
 *   saveManager.load('slot1');
 */

import { serializeState, serializeUnit } from '../runtime/StateSurface.js';
import { createSaveEnvelope, validateSaveEnvelope, migrateSaveEnvelope, extractSaveMetadata } from './SaveSchema.js';
import { defaultStorageAdapter } from './StorageAdapter.js';

/**
 * SaveManager orchestrates save/load operations.
 */
export class SaveManager {
    /**
     * @param {Object} game - Game instance with simLoop, rng, units, etc.
     * @param {Object} [storageAdapter] - Storage backend (default: localStorage)
     */
    constructor(game, storageAdapter = defaultStorageAdapter) {
        this.game = game;
        this.storage = storageAdapter;
    }

    /**
     * Save current game state to storage.
     *
     * @param {string} slotKey - Save slot identifier
     * @param {Object} [metadata] - Optional metadata (name, description)
     * @returns {{ success: boolean, error?: string }}
     */
    save(slotKey, metadata = {}) {
        try {
            const game = this.game;

            // 1. Serialize game state (units, commands, etc.)
            const gameState = serializeState(game);

            // 2. Get SimLoop state
            const simLoopState = game.simLoop?.getState?.() ?? {
                tickCount: game.simLoop?.tickCount ?? 0,
                accumulatorMs: game.simLoop?.accumulatorMs ?? 0
            };

            // 3. Get RNG state
            const rngState = game.rng?.getState?.() ?? {
                seed: 0,
                state: 0,
                callCount: 0
            };

            // 4. Get entity ID counter
            const entityIdCounter = game.idGenerator?.peekEntityId?.() ??
                                   game.entityIdCounter ?? 1;

            // 5. Create save envelope with versioning
            const envelope = createSaveEnvelope(
                gameState,
                simLoopState,
                rngState,
                entityIdCounter,
                metadata
            );

            // 6. Persist to storage
            const result = this.storage.save(slotKey, envelope);

            if (!result.success) {
                return { success: false, error: result.error };
            }

            return { success: true };

        } catch (err) {
            return {
                success: false,
                error: `Save failed: ${err.message}`
            };
        }
    }

    /**
     * Load and validate save data (does not apply to game).
     *
     * @param {string} slotKey - Save slot identifier
     * @returns {{ success: boolean, envelope?: Object, error?: string }}
     */
    loadEnvelope(slotKey) {
        // 1. Load from storage
        const loadResult = this.storage.load(slotKey);
        if (!loadResult.success) {
            return { success: false, error: loadResult.error };
        }

        // 2. Validate
        const validation = validateSaveEnvelope(loadResult.data);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // 3. Migrate if needed
        const envelope = migrateSaveEnvelope(loadResult.data);

        return { success: true, envelope };
    }

    /**
     * Load and apply saved state to game.
     *
     * @param {string} slotKey - Save slot identifier
     * @param {Object} [options] - Load options
     * @param {Function} [options.createUnit] - Unit factory function
     * @returns {{ success: boolean, error?: string }}
     */
    load(slotKey, options = {}) {
        // 1. Load envelope
        const loadResult = this.loadEnvelope(slotKey);
        if (!loadResult.success) {
            return loadResult;
        }

        const envelope = loadResult.envelope;
        const state = envelope.state;

        try {
            // 2. Apply to game
            this.applyState(state, options);

            return { success: true };

        } catch (err) {
            return {
                success: false,
                error: `Load failed: ${err.message}`
            };
        }
    }

    /**
     * Apply loaded state to game instance.
     * Separated for testability.
     *
     * @param {Object} state - State object from save envelope
     * @param {Object} [options] - Apply options
     */
    applyState(state, options = {}) {
        const game = this.game;

        // 1. Restore SimLoop state
        if (game.simLoop) {
            if (game.simLoop.setState) {
                game.simLoop.setState(state.simLoop);
            } else {
                // Fallback for older SimLoop
                game.simLoop.tickCount = state.simLoop.tickCount;
                game.simLoop.accumulatorMs = state.simLoop.accumulatorMs ?? 0;
                game.simLoop.lastFrameMs = 0;
            }
        }

        // 2. Restore RNG state
        if (game.rng && game.rng.setState) {
            game.rng.setState(state.rng);
        }

        // 3. Restore entity ID counter
        if (game.idGenerator && game.idGenerator.setEntityIdCounter) {
            game.idGenerator.setEntityIdCounter(state.entityIdCounter);
        } else if (game.setEntityIdCounter) {
            game.setEntityIdCounter(state.entityIdCounter);
        }

        // 4. Restore units
        this._restoreUnits(state.game.units, options);

        // 5. Restore selected unit
        if (state.game.selectedUnitId !== null && state.game.selectedUnitId !== undefined) {
            const selected = game.units?.find(u => u.id === state.game.selectedUnitId);
            if (selected) {
                game.selectedUnit = selected;
            }
        }
    }

    /**
     * Restore units from saved state.
     *
     * @param {Array} unitDataArray - Array of serialized unit data
     * @param {Object} options - Options with optional createUnit factory
     * @private
     */
    _restoreUnits(unitDataArray, options) {
        const game = this.game;

        // Clear existing units (render cleanup would be game's responsibility)
        if (game.units) {
            game.units.length = 0;
        } else {
            game.units = [];
        }

        if (!unitDataArray || unitDataArray.length === 0) {
            return;
        }

        // If game has a restoreUnit method, use it
        if (game.restoreUnit) {
            for (const unitData of unitDataArray) {
                game.restoreUnit(unitData);
            }
            return;
        }

        // If createUnit factory provided in options
        if (options.createUnit) {
            for (const unitData of unitDataArray) {
                const unit = options.createUnit(unitData);
                if (unit) {
                    game.units.push(unit);
                }
            }
            return;
        }

        // Fallback: Store raw data (game must hydrate later)
        for (const unitData of unitDataArray) {
            game.units.push(unitData);
        }
    }

    /**
     * Delete a save slot.
     *
     * @param {string} slotKey - Save slot identifier
     * @returns {{ success: boolean }}
     */
    deleteSave(slotKey) {
        return this.storage.delete(slotKey);
    }

    /**
     * List all save slots.
     *
     * @returns {string[]} Array of save slot keys
     */
    listSaves() {
        return this.storage.list();
    }

    /**
     * Check if a save slot exists.
     *
     * @param {string} slotKey - Save slot identifier
     * @returns {boolean}
     */
    hasSave(slotKey) {
        return this.storage.exists(slotKey);
    }

    /**
     * Get metadata for a save without loading full state.
     *
     * @param {string} slotKey - Save slot identifier
     * @returns {{ success: boolean, metadata?: Object, error?: string }}
     */
    getSaveMetadata(slotKey) {
        const loadResult = this.storage.load(slotKey);
        if (!loadResult.success) {
            return { success: false, error: loadResult.error };
        }

        const metadata = extractSaveMetadata(loadResult.data);
        return { success: true, metadata };
    }

    /**
     * Export save as JSON string (for file download).
     *
     * @param {string} slotKey - Save slot identifier
     * @returns {{ success: boolean, json?: string, error?: string }}
     */
    exportSave(slotKey) {
        const loadResult = this.storage.load(slotKey);
        if (!loadResult.success) {
            return { success: false, error: loadResult.error };
        }

        return {
            success: true,
            json: JSON.stringify(loadResult.data, null, 2)
        };
    }

    /**
     * Import save from JSON string (from file upload).
     *
     * @param {string} slotKey - Save slot to import into
     * @param {string} json - JSON string of save data
     * @returns {{ success: boolean, error?: string }}
     */
    importSave(slotKey, json) {
        try {
            const data = JSON.parse(json);

            const validation = validateSaveEnvelope(data);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }

            return this.storage.save(slotKey, data);

        } catch (err) {
            return {
                success: false,
                error: `Import failed: ${err.message}`
            };
        }
    }
}
