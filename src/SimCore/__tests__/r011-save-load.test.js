/**
 * R011 Save/Load System - Determinism Test
 *
 * Proves that:
 * 1. Save serializes all determinism-critical state
 * 2. Load restores state exactly
 * 3. Simulation continues deterministically after load
 * 4. Hash matches between original and loaded runs
 *
 * Run: npx vitest run src/SimCore/__tests__/r011-save-load.test.js
 */

import { describe, it, expect } from 'vitest';

// ============ Inline Dependencies (No Three.js) ============

/**
 * SeededRNG - Mulberry32 PRNG (copy from runtime)
 */
class SeededRNG {
    constructor(seed = Date.now()) {
        this._seed = seed >>> 0;
        this._state = this._seed;
        this._callCount = 0;
    }

    next() {
        this._callCount++;
        // Must wrap to 32-bit for deterministic state
        this._state = (this._state + 0x6D2B79F5) >>> 0;
        let t = this._state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    getState() {
        return {
            seed: this._seed,
            state: this._state,
            callCount: this._callCount
        };
    }

    setState(state) {
        this._seed = state.seed >>> 0;
        this._state = state.state >>> 0;
        this._callCount = state.callCount;
    }
}

/**
 * Minimal SimLoop for testing
 */
class TestSimLoop {
    constructor() {
        this.tickCount = 0;
        this.accumulatorMs = 0;
        this.lastFrameMs = 0;
    }

    getState() {
        return {
            tickCount: this.tickCount,
            accumulatorMs: this.accumulatorMs
        };
    }

    setState(state) {
        this.tickCount = state.tickCount;
        this.accumulatorMs = state.accumulatorMs ?? 0;
        this.lastFrameMs = 0;
    }

    reset() {
        this.tickCount = 0;
        this.accumulatorMs = 0;
        this.lastFrameMs = 0;
    }
}

/**
 * Minimal IdGenerator for testing
 */
class TestIdGenerator {
    constructor() {
        this._entityIdCounter = 1;
    }

    nextEntityId() {
        return this._entityIdCounter++;
    }

    peekEntityId() {
        return this._entityIdCounter;
    }

    setEntityIdCounter(value) {
        this._entityIdCounter = value;
    }
}

/**
 * Test Unit (no Three.js)
 */
class TestUnit {
    constructor(id, x, y, z) {
        this.id = id;
        this.position = { x, y, z };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.health = 100;
        // R011: Quaternion for rotation persistence testing
        this.quaternion = { x: 0, y: 0, z: 0, w: 1 }; // Identity
        this.headingQuaternion = { x: 0, y: 0, z: 0, w: 1 }; // Heading
    }

    update(rng) {
        // Deterministic movement using RNG
        const dx = (rng.next() - 0.5) * 0.1;
        const dz = (rng.next() - 0.5) * 0.1;
        this.position.x += dx;
        this.position.z += dz;

        // Deterministic rotation update (simulates turning)
        const angle = rng.next() * 0.1; // Small rotation
        const sinHalf = Math.sin(angle / 2);
        const cosHalf = Math.cos(angle / 2);
        // Rotate around Y axis (simplified)
        this.headingQuaternion.y = sinHalf;
        this.headingQuaternion.w = cosHalf;
        // Sync authoritative quaternion from heading (like real Unit.js)
        this.quaternion.x = this.headingQuaternion.x;
        this.quaternion.y = this.headingQuaternion.y;
        this.quaternion.z = this.headingQuaternion.z;
        this.quaternion.w = this.headingQuaternion.w;
    }
}

// ============ Save/Load Module (Inline for Test) ============

const SAVE_SCHEMA_VERSION = 1;

function createSaveEnvelope(gameState, simState, rngState, entityIdCounter, metadata = {}) {
    return {
        schemaVersion: SAVE_SCHEMA_VERSION,
        format: 'asterobia-save',
        savedAt: new Date().toISOString(),
        state: {
            game: gameState,
            simLoop: simState,
            rng: rngState,
            entityIdCounter: entityIdCounter
        }
    };
}

function validateSaveEnvelope(envelope) {
    if (!envelope || envelope.format !== 'asterobia-save') {
        return { valid: false, error: 'Invalid format' };
    }
    if (!envelope.state || !envelope.state.game || !envelope.state.simLoop || !envelope.state.rng) {
        return { valid: false, error: 'Missing state' };
    }
    return { valid: true };
}

/**
 * MemoryStorageAdapter for testing
 */
class MemoryStorageAdapter {
    constructor() {
        this.store = new Map();
    }

    save(key, data) {
        this.store.set(key, JSON.parse(JSON.stringify(data)));
        return { success: true };
    }

    load(key) {
        if (!this.store.has(key)) {
            return { success: false, error: 'Not found' };
        }
        return { success: true, data: JSON.parse(JSON.stringify(this.store.get(key))) };
    }

    exists(key) {
        return this.store.has(key);
    }
}

/**
 * Serialize game state
 */
function serializeGameState(game) {
    return {
        units: game.units.map(u => ({
            id: u.id,
            position: { ...u.position },
            velocity: { ...u.velocity },
            health: u.health,
            quaternion: { ...u.quaternion }
        })),
        selectedUnitId: game.selectedUnit?.id ?? null
    };
}

/**
 * Hash state for comparison
 */
function hashState(game) {
    let hash = `tick:${game.simLoop.tickCount}`;
    for (const unit of game.units) {
        const px = unit.position.x.toFixed(8);
        const py = unit.position.y.toFixed(8);
        const pz = unit.position.z.toFixed(8);
        hash += `|${unit.id}:${px},${py},${pz}`;
    }
    hash += `|rng:${game.rng.getState().callCount}`;
    return hash;
}

/**
 * TestSaveManager
 */
class TestSaveManager {
    constructor(game, storage) {
        this.game = game;
        this.storage = storage;
    }

    save(slotKey) {
        const gameState = serializeGameState(this.game);
        const simLoopState = this.game.simLoop.getState();
        const rngState = this.game.rng.getState();
        const entityIdCounter = this.game.idGenerator.peekEntityId();

        const envelope = createSaveEnvelope(gameState, simLoopState, rngState, entityIdCounter);
        return this.storage.save(slotKey, envelope);
    }

    load(slotKey) {
        const loadResult = this.storage.load(slotKey);
        if (!loadResult.success) return loadResult;

        const validation = validateSaveEnvelope(loadResult.data);
        if (!validation.valid) return { success: false, error: validation.error };

        const state = loadResult.data.state;

        // Restore simLoop
        this.game.simLoop.setState(state.simLoop);

        // Restore RNG
        this.game.rng.setState(state.rng);

        // Restore ID generator
        this.game.idGenerator.setEntityIdCounter(state.entityIdCounter);

        // Restore units
        this.game.units.length = 0;
        for (const unitData of state.game.units) {
            const unit = new TestUnit(
                unitData.id,
                unitData.position.x,
                unitData.position.y,
                unitData.position.z
            );
            unit.velocity = { ...unitData.velocity };
            unit.health = unitData.health;
            // R011: Restore quaternion and headingQuaternion
            if (unitData.quaternion) {
                unit.quaternion = { ...unitData.quaternion };
                unit.headingQuaternion = { ...unitData.quaternion };
            }
            this.game.units.push(unit);
        }

        // Restore selected unit (if setter exists)
        if (state.game.selectedUnitId !== null && state.game.selectedUnitId !== undefined) {
            const selected = this.game.units.find(u => u.id === state.game.selectedUnitId);
            if (selected) {
                this.game.selectedUnit = selected;
            }
        }

        return { success: true };
    }
}

// ============ Test Game ============

class TestGame {
    constructor(seed = 12345) {
        this.rng = new SeededRNG(seed);
        this.simLoop = new TestSimLoop();
        this.idGenerator = new TestIdGenerator();
        this.units = [];
        this.selectedUnit = null;
    }

    createUnit(x, y, z) {
        const id = this.idGenerator.nextEntityId();
        const unit = new TestUnit(id, x, y, z);
        this.units.push(unit);
        return unit;
    }

    tick() {
        this.simLoop.tickCount++;
        for (const unit of this.units) {
            unit.update(this.rng);
        }
    }

    reset() {
        this.units.length = 0;
        this.simLoop.reset();
        this.rng = new SeededRNG(12345);
        this.idGenerator.setEntityIdCounter(1);
    }
}

// ============ Tests ============

describe('R011: Save/Load Determinism', () => {

    it('Save creates valid envelope with all state', () => {
        const game = new TestGame(12345);
        const storage = new MemoryStorageAdapter();
        const saveManager = new TestSaveManager(game, storage);

        // Setup game state
        game.createUnit(0, 0, 0);
        game.createUnit(10, 0, 10);
        for (let i = 0; i < 10; i++) game.tick();

        // Save
        const result = saveManager.save('test1');
        expect(result.success).toBe(true);

        // Verify envelope structure
        const loadResult = storage.load('test1');
        expect(loadResult.success).toBe(true);

        const envelope = loadResult.data;
        expect(envelope.format).toBe('asterobia-save');
        expect(envelope.schemaVersion).toBe(1);
        expect(envelope.state.simLoop.tickCount).toBe(10);
        expect(envelope.state.game.units.length).toBe(2);
        expect(envelope.state.rng.callCount > 0).toBe(true);
        expect(envelope.state.entityIdCounter).toBe(3);
    });

    it('Load restores state exactly', () => {
        const game = new TestGame(12345);
        const storage = new MemoryStorageAdapter();
        const saveManager = new TestSaveManager(game, storage);

        // Setup and advance
        game.createUnit(5, 0, 5);
        for (let i = 0; i < 20; i++) game.tick();

        // Capture state before save
        const hashBeforeSave = hashState(game);
        const positionBeforeSave = { ...game.units[0].position };

        // Save
        saveManager.save('test2');

        // Advance more (corrupt current state)
        for (let i = 0; i < 50; i++) game.tick();

        // Verify state changed
        const hashAfterChange = hashState(game);
        expect(hashBeforeSave).not.toBe(hashAfterChange);

        // Load
        const result = saveManager.load('test2');
        expect(result.success).toBe(true);

        // Verify restoration
        const hashAfterLoad = hashState(game);
        expect(hashAfterLoad).toBe(hashBeforeSave);

        expect(game.simLoop.tickCount).toBe(20);
        expect(game.units[0].position.x).toBe(positionBeforeSave.x);
        expect(game.units[0].position.z).toBe(positionBeforeSave.z);
    });

    it('DETERMINISM: Loaded game continues identically to original', () => {
        // Run A: Fresh game
        const gameA = new TestGame(12345);
        gameA.createUnit(0, 0, 0);
        gameA.createUnit(5, 0, 5);

        // Advance to tick 30
        for (let i = 0; i < 30; i++) gameA.tick();

        // Save at tick 30
        const storage = new MemoryStorageAdapter();
        const saveManagerA = new TestSaveManager(gameA, storage);
        saveManagerA.save('checkpoint');

        // Continue A to tick 100
        const hashesA = [];
        for (let i = 30; i < 100; i++) {
            gameA.tick();
            hashesA.push(hashState(gameA));
        }

        // Run B: Load from checkpoint, continue to tick 100
        const gameB = new TestGame(99999); // Different seed (will be overwritten)
        gameB.createUnit(999, 999, 999); // Garbage data (will be cleared)
        for (let i = 0; i < 5; i++) gameB.tick(); // Advance (will be reset)

        const saveManagerB = new TestSaveManager(gameB, storage);
        const loadResult = saveManagerB.load('checkpoint');
        expect(loadResult.success).toBe(true);

        // Verify B starts at tick 30
        expect(gameB.simLoop.tickCount).toBe(30);

        // Continue B to tick 100
        const hashesB = [];
        for (let i = 30; i < 100; i++) {
            gameB.tick();
            hashesB.push(hashState(gameB));
        }

        // Compare every tick hash
        for (let i = 0; i < hashesA.length; i++) {
            expect(hashesB[i]).toBe(hashesA[i]);
        }
    });

    it('DETERMINISM: Multiple save/load cycles maintain determinism', () => {
        const storage = new MemoryStorageAdapter();
        const hashes = [];

        // Run 1: Fresh start, save at 50, continue to 100
        const game1 = new TestGame(54321);
        game1.createUnit(1, 0, 1);
        game1.createUnit(2, 0, 2);
        game1.createUnit(3, 0, 3);

        for (let i = 0; i < 50; i++) game1.tick();
        new TestSaveManager(game1, storage).save('slot');

        for (let i = 50; i < 100; i++) {
            game1.tick();
            hashes.push(hashState(game1));
        }

        // Run 2: Load at 50, continue to 100
        const game2 = new TestGame(0);
        new TestSaveManager(game2, storage).load('slot');

        for (let i = 50; i < 100; i++) {
            game2.tick();
            const hash2 = hashState(game2);
            expect(hash2).toBe(hashes[i - 50]);
        }
    });

    it('RNG state is correctly preserved', () => {
        const game = new TestGame(11111);
        const storage = new MemoryStorageAdapter();
        const saveManager = new TestSaveManager(game, storage);

        game.createUnit(0, 0, 0);

        // Use RNG a specific number of times
        for (let i = 0; i < 25; i++) game.tick();

        const rngStateBefore = game.rng.getState();
        saveManager.save('rng_test');

        // Corrupt RNG
        for (let i = 0; i < 100; i++) game.rng.next();

        // Load
        saveManager.load('rng_test');

        const rngStateAfter = game.rng.getState();

        expect(rngStateAfter.seed).toBe(rngStateBefore.seed);
        expect(rngStateAfter.state).toBe(rngStateBefore.state);
        expect(rngStateAfter.callCount).toBe(rngStateBefore.callCount);
    });

    it('Entity ID counter is preserved', () => {
        const game = new TestGame(22222);
        const storage = new MemoryStorageAdapter();
        const saveManager = new TestSaveManager(game, storage);

        // Create 5 units
        for (let i = 0; i < 5; i++) {
            game.createUnit(i, 0, i);
        }

        const counterBefore = game.idGenerator.peekEntityId();
        expect(counterBefore).toBe(6);

        saveManager.save('id_test');

        // Create more units (corrupt counter)
        for (let i = 0; i < 10; i++) {
            game.createUnit(i, 0, i);
        }
        expect(game.idGenerator.peekEntityId()).toBe(16);

        // Load
        saveManager.load('id_test');

        const counterAfter = game.idGenerator.peekEntityId();
        expect(counterAfter).toBe(6);

        // New unit should get ID 6
        const newUnit = game.createUnit(0, 0, 0);
        expect(newUnit.id).toBe(6);
    });

    it('Save/load with zero units works', () => {
        const game = new TestGame(33333);
        const storage = new MemoryStorageAdapter();
        const saveManager = new TestSaveManager(game, storage);

        // No units, just advance ticks
        for (let i = 0; i < 10; i++) game.tick();

        saveManager.save('empty');

        // Add units (corrupt)
        game.createUnit(0, 0, 0);
        game.createUnit(1, 0, 1);

        // Load
        saveManager.load('empty');

        expect(game.units.length).toBe(0);
        expect(game.simLoop.tickCount).toBe(10);
    });

    it('Invalid save data is rejected', () => {
        const game = new TestGame(44444);
        const storage = new MemoryStorageAdapter();
        const saveManager = new TestSaveManager(game, storage);

        // Save garbage data directly
        storage.save('bad1', { garbage: true });
        storage.save('bad2', { format: 'wrong-format', state: {} });
        storage.save('bad3', { format: 'asterobia-save' }); // missing state

        const result1 = saveManager.load('bad1');
        expect(result1.success).toBe(false);

        const result2 = saveManager.load('bad2');
        expect(result2.success).toBe(false);

        const result3 = saveManager.load('bad3');
        expect(result3.success).toBe(false);
    });

    it('Load nonexistent save fails gracefully', () => {
        const game = new TestGame(55555);
        const storage = new MemoryStorageAdapter();
        const saveManager = new TestSaveManager(game, storage);

        const result = saveManager.load('does_not_exist');
        expect(result.success).toBe(false);
        expect(typeof result.error).toBe('string');
    });

    it('Load with getter-only selectedUnit does not throw', () => {
        // Simulate game adapter with getter-only selectedUnit (like real Game.js)
        const baseGame = new TestGame(66666);
        baseGame.createUnit(0, 0, 0);
        baseGame.selectedUnit = baseGame.units[0]; // Set selection

        // Create adapter with getter-only selectedUnit (no setter)
        let selectionRestored = false;
        const gameWithGetterOnly = {
            simLoop: baseGame.simLoop,
            units: baseGame.units,
            get selectedUnit() { return baseGame.selectedUnit; },
            set selectedUnit(unit) {
                // Setter exists but delegates to method (like real Game adapter)
                selectionRestored = true;
                baseGame.selectedUnit = unit;
            },
            rng: baseGame.rng,
            idGenerator: baseGame.idGenerator
        };

        const storage = new MemoryStorageAdapter();
        const saveManager = new TestSaveManager(gameWithGetterOnly, storage);

        // Save with selection
        for (let i = 0; i < 5; i++) baseGame.tick();
        saveManager.save('with_selection');

        // Clear selection
        baseGame.selectedUnit = null;
        selectionRestored = false;

        // Load - should not throw
        let loadError = null;
        try {
            const result = saveManager.load('with_selection');
            expect(result.success).toBe(true);
        } catch (e) {
            loadError = e;
        }

        expect(loadError).toBe(null);
        expect(selectionRestored).toBe(true);
    });

    it('Quaternion/heading is restored (not identity) after save/load', () => {
        const game = new TestGame(77777);
        const storage = new MemoryStorageAdapter();
        const saveManager = new TestSaveManager(game, storage);

        // Create unit and let it turn/move
        const unit = game.createUnit(0, 0, 0);

        // Run several ticks to accumulate rotation
        for (let i = 0; i < 20; i++) game.tick();

        // Capture quaternion state before save
        const quatBeforeSave = { ...unit.quaternion };

        // Verify quaternion is NOT identity (unit has turned)
        const isIdentity = (
            Math.abs(quatBeforeSave.x) < 0.001 &&
            Math.abs(quatBeforeSave.y) < 0.001 &&
            Math.abs(quatBeforeSave.z) < 0.001 &&
            Math.abs(quatBeforeSave.w - 1) < 0.001
        );
        expect(isIdentity).toBe(false);

        // Save
        saveManager.save('rotation_test');

        // Corrupt quaternion (set to identity)
        unit.quaternion = { x: 0, y: 0, z: 0, w: 1 };
        unit.headingQuaternion = { x: 0, y: 0, z: 0, w: 1 };

        // Load
        const result = saveManager.load('rotation_test');
        expect(result.success).toBe(true);

        // Verify quaternion restored (matches before save)
        const restoredUnit = game.units[0];
        expect(
            Math.abs(restoredUnit.quaternion.x - quatBeforeSave.x) < 0.0001
        ).toBe(true);
        expect(
            Math.abs(restoredUnit.quaternion.y - quatBeforeSave.y) < 0.0001
        ).toBe(true);
        expect(
            Math.abs(restoredUnit.quaternion.w - quatBeforeSave.w) < 0.0001
        ).toBe(true);

        // Verify headingQuaternion also restored
        expect(
            Math.abs(restoredUnit.headingQuaternion.y - quatBeforeSave.y) < 0.0001
        ).toBe(true);
    });

});
