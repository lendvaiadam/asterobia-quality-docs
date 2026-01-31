/**
 * SaveSchema - Save File Schema & Versioning
 *
 * R011: Defines the save file format with schema versioning.
 * Enables future migrations when save format changes.
 *
 * Schema versions:
 * - v1: Initial R011 release
 */

/** Current schema version */
export const SAVE_SCHEMA_VERSION = 1;

/**
 * Create a save file envelope with metadata.
 *
 * @param {Object} gameState - Serialized game state from StateSurface
 * @param {Object} simState - SimLoop state (tickCount, accumulator)
 * @param {Object} rngState - SeededRNG state (seed, state, callCount)
 * @param {number} entityIdCounter - Current entity ID counter
 * @param {Object} [metadata] - Optional user metadata (save name, etc.)
 * @returns {Object} Complete save file object
 */
export function createSaveEnvelope(gameState, simState, rngState, entityIdCounter, metadata = {}) {
    return {
        // Schema info
        schemaVersion: SAVE_SCHEMA_VERSION,
        format: 'asterobia-save',

        // Timestamps
        savedAt: new Date().toISOString(),
        gameVersion: metadata.gameVersion || '0.1.0',

        // User metadata
        name: metadata.name || `Save ${new Date().toLocaleString()}`,
        description: metadata.description || '',

        // Core state
        state: {
            game: gameState,
            simLoop: simState,
            rng: rngState,
            entityIdCounter: entityIdCounter
        }
    };
}

/**
 * Validate a save file envelope.
 *
 * @param {Object} envelope - Loaded save data
 * @returns {{ valid: boolean, version?: number, error?: string }}
 */
export function validateSaveEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object') {
        return { valid: false, error: 'Invalid save data: not an object' };
    }

    if (envelope.format !== 'asterobia-save') {
        return { valid: false, error: 'Invalid save format identifier' };
    }

    if (typeof envelope.schemaVersion !== 'number') {
        return { valid: false, error: 'Missing schema version' };
    }

    if (envelope.schemaVersion > SAVE_SCHEMA_VERSION) {
        return {
            valid: false,
            error: `Save version ${envelope.schemaVersion} is newer than supported (${SAVE_SCHEMA_VERSION})`
        };
    }

    if (!envelope.state) {
        return { valid: false, error: 'Missing state object' };
    }

    const state = envelope.state;

    if (!state.game) {
        return { valid: false, error: 'Missing game state' };
    }

    if (!state.simLoop || typeof state.simLoop.tickCount !== 'number') {
        return { valid: false, error: 'Missing or invalid simLoop state' };
    }

    if (!state.rng || typeof state.rng.seed !== 'number') {
        return { valid: false, error: 'Missing or invalid RNG state' };
    }

    if (typeof state.entityIdCounter !== 'number') {
        return { valid: false, error: 'Missing entity ID counter' };
    }

    return { valid: true, version: envelope.schemaVersion };
}

/**
 * Migrate save data from older schema versions.
 * Add migration logic here as schema evolves.
 *
 * @param {Object} envelope - Save envelope to migrate
 * @returns {Object} Migrated envelope (at current schema version)
 */
export function migrateSaveEnvelope(envelope) {
    let current = { ...envelope };

    // Migration v0 -> v1 (placeholder for future)
    // if (current.schemaVersion < 1) {
    //     current = migrateV0ToV1(current);
    // }

    // Future migrations:
    // if (current.schemaVersion < 2) {
    //     current = migrateV1ToV2(current);
    // }

    current.schemaVersion = SAVE_SCHEMA_VERSION;
    return current;
}

/**
 * Extract save metadata for display (without loading full state).
 *
 * @param {Object} envelope - Save envelope
 * @returns {{ name: string, savedAt: string, tickCount: number, unitCount: number }}
 */
export function extractSaveMetadata(envelope) {
    return {
        name: envelope.name || 'Unnamed Save',
        savedAt: envelope.savedAt || 'Unknown',
        gameVersion: envelope.gameVersion || 'Unknown',
        tickCount: envelope.state?.simLoop?.tickCount ?? 0,
        unitCount: envelope.state?.game?.units?.length ?? 0
    };
}
