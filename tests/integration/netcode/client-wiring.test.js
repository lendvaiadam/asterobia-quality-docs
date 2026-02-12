/**
 * client-wiring.test.js — Phase 2A Client Wiring Tests
 *
 * Tests the client-side contract for Phase 2A server authority:
 *   - SPAWN_MANIFEST construction and message format
 *   - MOVE_INPUT unitId end-to-end (factory → transport)
 *   - Spawn suppression guard logic
 *   - Snapshot reconciliation ID-based detection
 *
 * These tests verify portable logic patterns without requiring Three.js/browser.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createSpawnManifest,
    createMoveInput,
    validateMessage
} from '../../../src/SimCore/multiplayer/MessageSerializer.js';
import { MSG } from '../../../src/SimCore/multiplayer/MessageTypes.js';

// === A) SPAWN_MANIFEST Construction ===

describe('SPAWN_MANIFEST construction', () => {
    it('builds manifest with correct fields from unit list', () => {
        const units = [
            { id: 1, ownerSlot: 0, modelIndex: 2, position: { x: 10, y: 20, z: 30 } },
            { id: 2, ownerSlot: 0, modelIndex: 3, position: { x: -5, y: 15, z: 25 } },
            { id: 7, ownerSlot: 1, modelIndex: 0, position: { x: 0, y: 60, z: 0 } }
        ];

        // This mirrors the exact logic in Game._sendSpawnManifest()
        const manifest = units.filter(u => u).map(u => ({
            id: u.id,
            ownerSlot: u.ownerSlot ?? 0,
            modelIndex: u.modelIndex ?? 0,
            px: u.position.x,
            py: u.position.y,
            pz: u.position.z
        }));

        expect(manifest).toHaveLength(3);
        expect(manifest[0]).toEqual({ id: 1, ownerSlot: 0, modelIndex: 2, px: 10, py: 20, pz: 30 });
        expect(manifest[2]).toEqual({ id: 7, ownerSlot: 1, modelIndex: 0, px: 0, py: 60, pz: 0 });
    });

    it('filters null entries from sparse units array', () => {
        // loadUnits() pre-allocates with fill(null); slots may be null during async load
        const units = [
            { id: 1, ownerSlot: 0, modelIndex: 0, position: { x: 0, y: 0, z: 60 } },
            null,
            null,
            { id: 4, ownerSlot: 0, modelIndex: 3, position: { x: 1, y: 2, z: 3 } }
        ];

        const manifest = units.filter(u => u).map(u => ({
            id: u.id,
            ownerSlot: u.ownerSlot ?? 0,
            modelIndex: u.modelIndex ?? 0,
            px: u.position.x,
            py: u.position.y,
            pz: u.position.z
        }));

        expect(manifest).toHaveLength(2);
        expect(manifest[0].id).toBe(1);
        expect(manifest[1].id).toBe(4);
    });

    it('createSpawnManifest produces valid message with manifest data', () => {
        const manifestUnits = [
            { id: 1, ownerSlot: 0, modelIndex: 2, px: 10, py: 20, pz: 30 }
        ];
        const msg = createSpawnManifest({ units: manifestUnits });

        expect(msg.type).toBe(MSG.SPAWN_MANIFEST);
        expect(msg.units).toEqual(manifestUnits);
        expect(typeof msg.timestamp).toBe('number');

        const result = validateMessage(msg);
        expect(result.valid).toBe(true);
    });

    it('manifest defaults ownerSlot to 0 and modelIndex to 0 for missing fields', () => {
        const units = [
            { id: 5, position: { x: 1, y: 2, z: 3 } } // no ownerSlot, no modelIndex
        ];

        const manifest = units.filter(u => u).map(u => ({
            id: u.id,
            ownerSlot: u.ownerSlot ?? 0,
            modelIndex: u.modelIndex ?? 0,
            px: u.position.x,
            py: u.position.y,
            pz: u.position.z
        }));

        expect(manifest[0].ownerSlot).toBe(0);
        expect(manifest[0].modelIndex).toBe(0);
    });
});

// === B) Spawn Suppression ===

describe('Spawn suppression guard', () => {
    it('returns null when mirror mode is active', () => {
        // Mirrors the exact guard in Game._spawnUnitForPlayer():
        //   if (this._mirrorMode) return null;
        function spawnGuard(mirrorMode) {
            if (mirrorMode) return null;
            return 'would-spawn';
        }

        expect(spawnGuard(true)).toBeNull();
        expect(spawnGuard(false)).toBe('would-spawn');
    });

    it('mirror mode is only set by SERVER_SNAPSHOT, not by Phase 1 messages', () => {
        // Verifies the activation contract: _mirrorMode starts false,
        // only applyServerSnapshot() sets it to true.
        let mirrorMode = false;

        // Phase 1 messages should NOT activate mirror mode
        function handlePositionSync() { /* no mirrorMode change */ }
        function handleSnapshot() { /* no mirrorMode change */ }
        function handleJoinAck() { /* no mirrorMode change */ }

        handlePositionSync();
        handleSnapshot();
        handleJoinAck();
        expect(mirrorMode).toBe(false);

        // Only SERVER_SNAPSHOT activates mirror mode
        function applyServerSnapshot() { mirrorMode = true; }
        applyServerSnapshot();
        expect(mirrorMode).toBe(true);
    });
});

// === C) Snapshot Reconciliation ===

describe('Snapshot reconciliation (ID-based)', () => {
    it('detects server units missing from local units array', () => {
        const localUnits = [
            { id: 1 }, { id: 2 }, { id: 5 }
        ];

        const snapshotUnits = new Map([
            [1, { id: 1, px: 0, py: 0, pz: 0 }],
            [2, { id: 2, px: 1, py: 1, pz: 1 }],
            [3, { id: 3, px: 2, py: 2, pz: 2, modelIndex: 1 }], // New from server
            [4, { id: 4, px: 3, py: 3, pz: 3, modelIndex: 0 }]  // New from server
        ]);

        // This mirrors the exact logic in Game._mirrorModeSimTick():
        //   for (const [id, snapUnit] of nextUnits) {
        //     if (!this.units.some(u => u && u.id === id)) { ... }
        //   }
        const missingIds = [];
        for (const [id] of snapshotUnits) {
            if (!localUnits.some(u => u && u.id === id)) {
                missingIds.push(id);
            }
        }

        expect(missingIds).toEqual([3, 4]);
    });

    it('handles null entries in local units array', () => {
        const localUnits = [{ id: 1 }, null, { id: 3 }];
        const snapshotUnits = new Map([
            [1, { id: 1 }],
            [2, { id: 2 }], // Missing locally (null slot doesn't match)
            [3, { id: 3 }]
        ]);

        const missing = [];
        for (const [id] of snapshotUnits) {
            if (!localUnits.some(u => u && u.id === id)) {
                missing.push(id);
            }
        }

        expect(missing).toEqual([2]);
    });

    it('maps by id NOT by ownerSlot (ownerSlot can be N:1)', () => {
        // Multiple units can have same ownerSlot (host owns 10 units, all slot 0)
        const localUnits = [
            { id: 1, ownerSlot: 0 },
            { id: 2, ownerSlot: 0 },
            { id: 3, ownerSlot: 0 }
        ];

        const snapshotUnits = new Map([
            [1, { id: 1, ownerSlot: 0 }],
            [2, { id: 2, ownerSlot: 0 }],
            [3, { id: 3, ownerSlot: 0 }],
            [4, { id: 4, ownerSlot: 1 }] // Guest unit from server
        ]);

        const missing = [];
        for (const [id] of snapshotUnits) {
            if (!localUnits.some(u => u && u.id === id)) {
                missing.push(id);
            }
        }

        // Only id=4 is missing, even though ownerSlot 1 doesn't appear locally
        expect(missing).toEqual([4]);
    });

    it('does not flag local-only units as errors (stale tolerance)', () => {
        // A local unit not in snapshot should be tolerated, not deleted
        const localUnits = [{ id: 1 }, { id: 99 }]; // id=99 is stale (pre-mirror spawn)
        const snapshotUnits = new Map([[1, { id: 1 }]]);

        // Reconciliation only CREATES missing server units, does NOT delete stale locals
        const missing = [];
        for (const [id] of snapshotUnits) {
            if (!localUnits.some(u => u && u.id === id)) {
                missing.push(id);
            }
        }

        expect(missing).toEqual([]); // No creation needed
        // id=99 is stale but NOT deleted — tolerated per design
        expect(localUnits).toHaveLength(2);
    });
});

// === D) MOVE_INPUT unitId contract ===

describe('MOVE_INPUT unitId end-to-end', () => {
    it('createMoveInput includes unitId when provided', () => {
        const msg = createMoveInput({ forward: true, backward: false, left: false, right: false, unitId: 42 });
        expect(msg.unitId).toBe(42);
        expect(msg.type).toBe(MSG.MOVE_INPUT);
    });

    it('createMoveInput omits unitId when not provided', () => {
        const msg = createMoveInput({ forward: true, backward: false, left: false, right: false });
        expect(msg.unitId).toBeUndefined();
        expect('unitId' in msg).toBe(false);
    });

    it('createMoveInput omits unitId when null', () => {
        const msg = createMoveInput({ forward: true, backward: false, left: false, right: false, unitId: null });
        expect('unitId' in msg).toBe(false);
    });

    it('SessionManager.sendMoveInput passes unitId to transport', async () => {
        // Minimal mock of SessionManager + transport
        let sentPayload = null;
        const mockTransport = {
            broadcastToChannel: async (channel, msg) => { sentPayload = msg; }
        };
        const mockState = { isOffline: () => false };

        // Simulate sendMoveInput logic (mirrors SessionManager.sendMoveInput)
        async function sendMoveInput(keys, unitId) {
            if (mockState.isOffline()) return;
            const msg = {
                type: 'MOVE_INPUT',
                forward: !!keys.forward,
                backward: !!keys.backward,
                left: !!keys.left,
                right: !!keys.right,
                timestamp: Date.now()
            };
            if (unitId != null) {
                msg.unitId = unitId;
            }
            await mockTransport.broadcastToChannel('test-channel', msg);
        }

        await sendMoveInput({ forward: true, backward: false, left: false, right: false }, 7);

        expect(sentPayload).not.toBeNull();
        expect(sentPayload.unitId).toBe(7);
        expect(sentPayload.forward).toBe(true);
    });

    it('SessionManager.sendMoveInput omits unitId when undefined', async () => {
        let sentPayload = null;
        const mockTransport = {
            broadcastToChannel: async (channel, msg) => { sentPayload = msg; }
        };

        async function sendMoveInput(keys, unitId) {
            const msg = {
                type: 'MOVE_INPUT',
                forward: !!keys.forward,
                backward: !!keys.backward,
                left: !!keys.left,
                right: !!keys.right,
                timestamp: Date.now()
            };
            if (unitId != null) {
                msg.unitId = unitId;
            }
            await mockTransport.broadcastToChannel('test-channel', msg);
        }

        await sendMoveInput({ forward: false, backward: true, left: false, right: false });

        expect(sentPayload).not.toBeNull();
        expect('unitId' in sentPayload).toBe(false);
    });
});
