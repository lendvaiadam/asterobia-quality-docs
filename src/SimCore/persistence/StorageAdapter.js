/**
 * StorageAdapter - Swappable Storage Backend
 *
 * R011: Provides a simple interface for save/load persistence.
 * Default implementation uses localStorage.
 * Can be replaced with IndexedDB, server backend, etc.
 *
 * Interface:
 * - save(key, data) - Persist JSON data
 * - load(key) - Retrieve JSON data
 * - delete(key) - Remove saved data
 * - list() - List all save keys
 */

/**
 * LocalStorageAdapter - Default storage using browser localStorage.
 */
export class LocalStorageAdapter {
    /**
     * @param {string} [prefix='asterobia_save_'] - Key prefix for namespacing
     */
    constructor(prefix = 'asterobia_save_') {
        this.prefix = prefix;
    }

    /**
     * Save data to localStorage.
     * @param {string} key - Save slot key
     * @param {Object} data - Data to persist (will be JSON stringified)
     * @returns {{ success: boolean, error?: string }}
     */
    save(key, data) {
        try {
            const fullKey = this.prefix + key;
            const json = JSON.stringify(data);
            localStorage.setItem(fullKey, json);
            return { success: true };
        } catch (err) {
            return {
                success: false,
                error: err.message || 'localStorage save failed'
            };
        }
    }

    /**
     * Load data from localStorage.
     * @param {string} key - Save slot key
     * @returns {{ success: boolean, data?: Object, error?: string }}
     */
    load(key) {
        try {
            const fullKey = this.prefix + key;
            const json = localStorage.getItem(fullKey);

            if (json === null) {
                return { success: false, error: 'Save not found' };
            }

            const data = JSON.parse(json);
            return { success: true, data };
        } catch (err) {
            return {
                success: false,
                error: err.message || 'localStorage load failed'
            };
        }
    }

    /**
     * Delete a save from localStorage.
     * @param {string} key - Save slot key
     * @returns {{ success: boolean }}
     */
    delete(key) {
        try {
            const fullKey = this.prefix + key;
            localStorage.removeItem(fullKey);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * List all save keys.
     * @returns {string[]} Array of save keys (without prefix)
     */
    list() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const fullKey = localStorage.key(i);
            if (fullKey && fullKey.startsWith(this.prefix)) {
                keys.push(fullKey.slice(this.prefix.length));
            }
        }
        return keys;
    }

    /**
     * Check if a save exists.
     * @param {string} key - Save slot key
     * @returns {boolean}
     */
    exists(key) {
        const fullKey = this.prefix + key;
        return localStorage.getItem(fullKey) !== null;
    }
}

/**
 * MemoryStorageAdapter - In-memory storage for testing.
 * Does not persist across page reloads.
 */
export class MemoryStorageAdapter {
    constructor() {
        /** @type {Map<string, Object>} */
        this.store = new Map();
    }

    save(key, data) {
        // Deep clone to simulate serialization
        this.store.set(key, JSON.parse(JSON.stringify(data)));
        return { success: true };
    }

    load(key) {
        if (!this.store.has(key)) {
            return { success: false, error: 'Save not found' };
        }
        // Deep clone to simulate deserialization
        const data = JSON.parse(JSON.stringify(this.store.get(key)));
        return { success: true, data };
    }

    delete(key) {
        this.store.delete(key);
        return { success: true };
    }

    list() {
        return Array.from(this.store.keys());
    }

    exists(key) {
        return this.store.has(key);
    }

    /** Clear all saves (test utility) */
    clear() {
        this.store.clear();
    }
}

// Default adapter instance
export const defaultStorageAdapter = new LocalStorageAdapter();
