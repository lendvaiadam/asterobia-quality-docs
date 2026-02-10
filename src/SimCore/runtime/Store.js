/**
 * Store - Central State Container for SimCore
 * 
 * Engine-agnostic reactive state store.
 * No Three.js or rendering dependencies allowed here.
 * 
 * @example
 * const store = new Store({ timeScale: 1, paused: false });
 * store.subscribe('timeScale', (newVal, oldVal) => console.log('Speed changed:', newVal));
 * store.set('timeScale', 2);
 */
export class Store {
    /**
     * @param {Object} initialState - Initial state values
     */
    constructor(initialState = {}) {
        /** @type {Map<string, *>} */
        this._state = new Map(Object.entries(initialState));
        
        /** @type {Map<string, Set<Function>>} */
        this._subscribers = new Map();
        
        /** @type {Set<Function>} */
        this._globalSubscribers = new Set();
    }

    /**
     * Get a value from the store
     * @param {string} key - State key
     * @param {*} [defaultValue] - Default if key doesn't exist
     * @returns {*}
     */
    get(key, defaultValue = undefined) {
        if (this._state.has(key)) {
            return this._state.get(key);
        }
        return defaultValue;
    }

    /**
     * Set a value in the store (triggers subscribers)
     * @param {string} key - State key
     * @param {*} value - New value
     */
    set(key, value) {
        const oldValue = this._state.get(key);
        
        // Skip if value hasn't changed (shallow comparison)
        if (oldValue === value) {
            return;
        }
        
        this._state.set(key, value);
        
        // Notify key-specific subscribers
        const subscribers = this._subscribers.get(key);
        if (subscribers) {
            subscribers.forEach(handler => {
                try {
                    handler(value, oldValue, key);
                } catch (error) {
                    console.error(`[Store] Error in subscriber for "${key}":`, error);
                }
            });
        }
        
        // Notify global subscribers
        this._globalSubscribers.forEach(handler => {
            try {
                handler(key, value, oldValue);
            } catch (error) {
                console.error(`[Store] Error in global subscriber:`, error);
            }
        });
    }

    /**
     * Update multiple values at once
     * @param {Object} updates - Key-value pairs to update
     */
    setMany(updates) {
        Object.entries(updates).forEach(([key, value]) => {
            this.set(key, value);
        });
    }

    /**
     * Subscribe to changes on a specific key
     * @param {string} key - State key to watch
     * @param {Function} handler - Callback (newValue, oldValue, key)
     * @returns {Function} Unsubscribe function
     */
    subscribe(key, handler) {
        if (!this._subscribers.has(key)) {
            this._subscribers.set(key, new Set());
        }
        this._subscribers.get(key).add(handler);
        
        return () => {
            const subscribers = this._subscribers.get(key);
            if (subscribers) {
                subscribers.delete(handler);
            }
        };
    }

    /**
     * Subscribe to all state changes
     * @param {Function} handler - Callback (key, newValue, oldValue)
     * @returns {Function} Unsubscribe function
     */
    subscribeAll(handler) {
        this._globalSubscribers.add(handler);
        return () => this._globalSubscribers.delete(handler);
    }

    /**
     * Check if a key exists in the store
     * @param {string} key 
     * @returns {boolean}
     */
    has(key) {
        return this._state.has(key);
    }

    /**
     * Get all keys in the store
     * @returns {string[]}
     */
    keys() {
        return Array.from(this._state.keys());
    }

    /**
     * Get a snapshot of the entire state (for serialization/debugging)
     * @returns {Object}
     */
    getSnapshot() {
        const snapshot = {};
        this._state.forEach((value, key) => {
            snapshot[key] = value;
        });
        return snapshot;
    }

    /**
     * Load state from a snapshot
     * @param {Object} snapshot 
     */
    loadSnapshot(snapshot) {
        Object.entries(snapshot).forEach(([key, value]) => {
            this.set(key, value);
        });
    }

    /**
     * Clear all state and subscribers
     */
    clear() {
        this._state.clear();
        this._subscribers.clear();
        this._globalSubscribers.clear();
    }
}

// Default initial state for the game
const DEFAULT_GAME_STATE = {
    // Time control
    timeScale: 1.0,
    paused: false,
    
    // Selection state
    selectedUnitId: null,
    hoveredUnitId: null,
    
    // Debug flags
    debugMode: false,
    showColliders: false,
    showNavMesh: false,
    
    // Game session
    sessionStartTime: 0,
    totalSimulatedTime: 0
};

// Singleton instance for global use
export const globalStore = new Store(DEFAULT_GAME_STATE);
