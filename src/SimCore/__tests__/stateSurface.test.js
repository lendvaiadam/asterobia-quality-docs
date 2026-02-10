/**
 * StateSurface Verification Test
 *
 * Validates serializeState/serializeUnit produce correct authoritative snapshots.
 *
 * Run: npx vitest run src/SimCore/__tests__/stateSurface.test.js
 */

import { describe, it, expect } from 'vitest';
import {
    serializeState,
    serializeUnit,
    hashState,
    compareStates
} from '../runtime/StateSurface.js';

// ============ Mock Data ============

function createMockUnit(id, overrides = {}) {
    return {
        id,
        name: `Unit_${id}`,
        position: { x: 10 + id, y: 0, z: 20 + id },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 1, y: 0, z: 0 },
        velocityDirection: { x: 1, y: 0, z: 0 },
        speed: 5.0,
        currentSpeed: 5.0,
        turnSpeed: 2.0,
        groundOffset: 0.22,
        pathIndex: 0,
        isFollowingPath: false,
        loopingEnabled: false,
        isPathClosed: false,
        waypoints: [],
        targetWaypointId: null,
        lastWaypointId: null,
        commands: [],
        currentCommandIndex: 0,
        health: 100,
        maxHealth: 100,
        shieldLevel: 0,
        disabled: false,
        pausedByCommand: false,
        waterState: 'normal',
        isStuck: false,
        ...overrides
    };
}

function createMockGame(units = []) {
    return {
        units,
        simLoop: { tickCount: 50, getSimTimeSec: () => 2.5 },
        commandQueue: { pendingCount: 0, historyCount: 10 },
        selectedUnit: units[0] || null
    };
}

// ============ Tests ============

describe('StateSurface', () => {
    it('serializeUnit returns authoritative fields only', () => {
        const unit = createMockUnit(1);
        // Add render-only fields that should be EXCLUDED
        unit.mesh = { visible: true };
        unit.isSelected = true;
        unit.isHovered = true;
        unit.dustEffect = {};

        const serialized = serializeUnit(unit);

        // Check authoritative fields present
        expect(serialized.id).toBe(1);
        expect(serialized.health).toBe(100);
        expect(JSON.stringify(serialized.position)).toBe(JSON.stringify({ x: 11, y: 0, z: 21 }));

        // Check render-only fields EXCLUDED
        expect(serialized.mesh).toBe(undefined);
        expect(serialized.isSelected).toBe(undefined);
        expect(serialized.isHovered).toBe(undefined);
        expect(serialized.dustEffect).toBe(undefined);
    });

    it('serializeUnit handles null input', () => {
        const result = serializeUnit(null);
        expect(result).toBe(null);
    });

    it('serializeState captures game state', () => {
        const units = [createMockUnit(1), createMockUnit(2)];
        const game = createMockGame(units);

        const state = serializeState(game);

        expect(state.version).toBe(1);
        expect(state.tickCount).toBe(50);
        expect(state.units.length).toBe(2);
        expect(state.selectedUnitId).toBe(1);
    });

    it('hashState is deterministic', () => {
        const units = [createMockUnit(1), createMockUnit(2)];
        const game = createMockGame(units);

        const state = serializeState(game);
        const hash1 = hashState(state);
        const hash2 = hashState(state);

        expect(hash1).toBe(hash2);
        expect(typeof hash1).toBe('string');
    });

    it('compareStates returns equal for identical states', () => {
        const units1 = [createMockUnit(1)];
        const units2 = [createMockUnit(1)];

        const state1 = serializeState(createMockGame(units1));
        const state2 = serializeState(createMockGame(units2));

        const result = compareStates(state1, state2);

        expect(result.equal).toBe(true);
        expect(result.differences.length).toBe(0);
    });

    it('compareStates detects position drift', () => {
        const unit1 = createMockUnit(1);
        const unit2 = createMockUnit(1);
        unit2.position.x += 0.001; // Small drift

        const state1 = serializeState(createMockGame([unit1]));
        const state2 = serializeState(createMockGame([unit2]));

        const result = compareStates(state1, state2);

        expect(result.equal).toBe(false);
        expect(result.differences.length > 0).toBe(true);
    });

    it('compareStates with epsilon tolerance', () => {
        const unit1 = createMockUnit(1);
        const unit2 = createMockUnit(1);
        unit2.position.x += 0.0001; // Tiny drift

        const state1 = serializeState(createMockGame([unit1]));
        const state2 = serializeState(createMockGame([unit2]));

        // With epsilon = 0, should detect difference
        const exactResult = compareStates(state1, state2, { positionEpsilon: 0 });
        expect(exactResult.equal).toBe(false);

        // With epsilon = 0.001, should be equal
        const tolerantResult = compareStates(state1, state2, { positionEpsilon: 0.001 });
        expect(tolerantResult.equal).toBe(true);
    });

    it('serializeUnit serializes commands', () => {
        const unit = createMockUnit(1, {
            commands: [
                { id: 'cmd1', type: 'MOVE', params: { position: { x: 5, y: 0, z: 10 } }, status: 'pending' },
                { id: 'cmd2', type: 'STOP', params: {}, status: 'completed' }
            ]
        });

        const serialized = serializeUnit(unit);

        expect(serialized.commands.length).toBe(2);
        expect(serialized.commands[0].type).toBe('MOVE');
        expect(serialized.commands[1].type).toBe('STOP');
    });
});
