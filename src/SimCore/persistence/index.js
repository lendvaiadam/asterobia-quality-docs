/**
 * SimCore Persistence Module
 *
 * R011: Save/Load system for game state persistence.
 *
 * Exports:
 * - SaveManager: Main save/load orchestrator
 * - StorageAdapters: localStorage, memory (for testing)
 * - Schema utilities: versioning, validation, migration
 */

export { SaveManager } from './SaveManager.js';

export {
    LocalStorageAdapter,
    MemoryStorageAdapter,
    defaultStorageAdapter
} from './StorageAdapter.js';

export {
    SAVE_SCHEMA_VERSION,
    createSaveEnvelope,
    validateSaveEnvelope,
    migrateSaveEnvelope,
    extractSaveMetadata
} from './SaveSchema.js';
