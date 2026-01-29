/**
 * TypeBlueprint - Unit Type Definition Model
 *
 * Represents a unit type's feature allocation.
 * JSON-serializable for persistence and network sync.
 *
 * NO Three.js or rendering dependencies.
 */

import { rngNextInt } from '../runtime/SeededRNG.js';

/**
 * Generate a UUID v4
 * R004: Fallback uses seeded RNG for determinism.
 * @returns {string}
 */
function generateUUID() {
    // R004: Always use deterministic SeededRNG for UUIDs to ensure simulation consistency.
    // We removed crypto.randomUUID() because it breaks determinism across clients/replays.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = rngNextInt(16);
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Current schema version for migration support
 */
export const BLUEPRINT_SCHEMA_VERSION = 1;

/**
 * @typedef {Object} TypeBlueprintData
 * @property {string} id - UUID
 * @property {string} ownerId - Owner identifier (required, never null)
 * @property {string} name - Display name
 * @property {number} designPct - Design percentage (20, 40, ... 200)
 * @property {Object<string, number>} allocations - Feature allocations (sum to 1.0)
 * @property {Object<string, Object<string, number>>} subAllocations - Sub-allocations per feature
 * @property {boolean} isSeed - True if factory seed blueprint
 * @property {number} schemaVersion - For migration support
 * @property {number} createdAt - Unix timestamp ms
 * @property {number} updatedAt - Unix timestamp ms
 * @property {Object} metadata - Extensible metadata
 */

/**
 * TypeBlueprint class
 */
export class TypeBlueprint {
    /**
     * @param {Partial<TypeBlueprintData>} data - Initial data
     */
    constructor(data = {}) {
        const now = Date.now();
        
        /** @type {string} */
        this.id = data.id || generateUUID();
        
        /** @type {string} */
        this.ownerId = data.ownerId || 'local';
        
        /** @type {string} */
        this.name = data.name || 'Unnamed Type';
        
        /** @type {number} */
        this.designPct = data.designPct || 100;
        
        /** @type {Object<string, number>} */
        this.allocations = data.allocations ? { ...data.allocations } : {};
        
        /** @type {Object<string, Object<string, number>>} */
        this.subAllocations = data.subAllocations 
            ? JSON.parse(JSON.stringify(data.subAllocations)) 
            : {};
        
        /** @type {boolean} */
        this.isSeed = data.isSeed || false;
        
        /** @type {number} */
        this.schemaVersion = data.schemaVersion || BLUEPRINT_SCHEMA_VERSION;
        
        /** @type {number} */
        this.createdAt = data.createdAt || now;
        
        /** @type {number} */
        this.updatedAt = data.updatedAt || now;
        
        /** @type {Object} */
        this.metadata = data.metadata ? { ...data.metadata } : {};
    }

    /**
     * Get list of included feature IDs (allocation > 0)
     * @returns {string[]}
     */
    getIncludedFeatures() {
        return Object.entries(this.allocations)
            .filter(([_, pct]) => pct > 0)
            .map(([id]) => id);
    }

    /**
     * Get feature count (features with allocation > 0)
     * @returns {number}
     */
    getFeatureCount() {
        return this.getIncludedFeatures().length;
    }

    /**
     * Get total allocation (should be 1.0)
     * @returns {number}
     */
    getTotalAllocation() {
        return Object.values(this.allocations).reduce((sum, v) => sum + v, 0);
    }

    /**
     * Set a feature allocation
     * @param {string} featureId 
     * @param {number} allocation - 0.0 to 1.0
     */
    setAllocation(featureId, allocation) {
        if (allocation <= 0) {
            delete this.allocations[featureId];
            delete this.subAllocations[featureId];
        } else {
            this.allocations[featureId] = allocation;
        }
        this.updatedAt = Date.now();
    }

    /**
     * Set sub-allocation for a feature
     * @param {string} featureId 
     * @param {Object<string, number>} subAlloc - e.g. { range: 0.33, power: 0.33, rate: 0.34 }
     */
    setSubAllocation(featureId, subAlloc) {
        if (subAlloc && Object.keys(subAlloc).length > 0) {
            this.subAllocations[featureId] = { ...subAlloc };
        } else {
            delete this.subAllocations[featureId];
        }
        this.updatedAt = Date.now();
    }

    /**
     * Get sub-allocation for a feature
     * @param {string} featureId 
     * @returns {Object<string, number>|null}
     */
    getSubAllocation(featureId) {
        return this.subAllocations[featureId] || null;
    }

    /**
     * Serialize to plain JSON object
     * @returns {TypeBlueprintData}
     */
    serialize() {
        return {
            id: this.id,
            ownerId: this.ownerId,
            name: this.name,
            designPct: this.designPct,
            allocations: { ...this.allocations },
            subAllocations: JSON.parse(JSON.stringify(this.subAllocations)),
            isSeed: this.isSeed,
            schemaVersion: this.schemaVersion,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            metadata: { ...this.metadata }
        };
    }

    /**
     * Create a TypeBlueprint from serialized data
     * @param {TypeBlueprintData} data 
     * @returns {TypeBlueprint}
     */
    static deserialize(data) {
        return new TypeBlueprint(data);
    }

    /**
     * Create a deep clone
     * @returns {TypeBlueprint}
     */
    clone() {
        const cloned = new TypeBlueprint(this.serialize());
        cloned.id = generateUUID(); // New ID for clone
        cloned.createdAt = Date.now();
        cloned.updatedAt = Date.now();
        cloned.isSeed = false; // Clones are not seeds
        return cloned;
    }

    /**
     * Mark as updated (sets updatedAt to now)
     */
    touch() {
        this.updatedAt = Date.now();
    }
}

// ============================================
// SEED BLUEPRINT FACTORY
// ============================================

/**
 * Create the default seed blueprint: Base Station
 * vision + research + design + produce_repair (25% each)
 * @returns {TypeBlueprint}
 */
export function createSeedBlueprint() {
    return new TypeBlueprint({
        ownerId: 'local',
        name: 'Base Station',
        designPct: 100,
        allocations: {
            vision: 0.25,
            research: 0.25,
            design: 0.25,
            produce_repair: 0.25
        },
        subAllocations: {},
        isSeed: true,
        metadata: {
            description: 'Default starting unit type with R&D capabilities'
        }
    });
}

/**
 * Create a mobile scout seed blueprint
 * move + vision (50% each)
 * @returns {TypeBlueprint}
 */
export function createScoutSeedBlueprint() {
    return new TypeBlueprint({
        ownerId: 'local',
        name: 'Scout',
        designPct: 60,
        allocations: {
            move: 0.50,
            vision: 0.50
        },
        subAllocations: {},
        isSeed: true,
        metadata: {
            description: 'Fast exploration unit'
        }
    });
}
