/**
 * seatAuthority.test.js - Regression Tests for Seat Authority System
 *
 * Tests: GAP-0 Seat Authority Gates
 * - Keyboard control blocked without seat
 * - Selection blocked for locked units (guest)
 * - Path commands rejected without seat
 *
 * Reference: GAP-0 Seat Acquisition Spec, M07 Game Loop
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../multiplayer/SessionManager.js';
import { NetworkRole } from '../multiplayer/NetworkRole.js';

/**
 * Mock Game object for seat authority testing
 */
function createMockGame(options = {}) {
    return {
        clientId: options.clientId || 'guest-id',
        _isDevMode: false,
        simLoop: { tickCount: 100 },
        units: options.units || [
            { id: 1, ownerSlot: 0, controllerSlot: null, seatPolicy: 'OPEN' },
            { id: 2, ownerSlot: 0, controllerSlot: 1, seatPolicy: 'OPEN' }, // Controlled by slot 1
            { id: 3, ownerSlot: 0, controllerSlot: 2, seatPolicy: 'PIN_1DIGIT', seatPinDigit: 5 } // Controlled by slot 2
        ],
        selectedUnit: null,
        stateSurface: { serialize: () => ({}), deserialize: vi.fn() },
        seatKeypadOverlay: {
            isVisible: false,
            show: vi.fn(),
            showError: vi.fn()
        },
        onSeatGranted: vi.fn()
    };
}

/**
 * Mock Transport for testing
 */
function createMockTransport() {
    const channels = new Map();
    const sentMessages = [];

    return {
        _channels: channels,
        _sentMessages: sentMessages,
        joinChannel: vi.fn(async (channelName, callback) => {
            channels.set(channelName, { callback });
        }),
        broadcastToChannel: vi.fn(async (channelName, msg) => {
            sentMessages.push({ channel: channelName, msg });
        }),
        leaveChannel: vi.fn(async (channelName) => {
            channels.delete(channelName);
        }),
        onMessage: vi.fn(),
        getSentMessages: () => sentMessages,
        clearSentMessages: () => { sentMessages.length = 0; }
    };
}

/**
 * Mock InteractionManager helpers for seat authority
 */
function createMockInteractionManager(game) {
    const inputFactory = {
        select: vi.fn(),
        deselect: vi.fn(),
        move: vi.fn(),
        setPath: vi.fn()
    };

    return {
        game,
        inputFactory,
        state: 'IDLE',
        mouseDownUnit: null,
        mouseDownTerrain: null,

        /**
         * Simulate _hasSeatAuthority check (mirrors InteractionManager logic)
         */
        _hasSeatAuthority(unit) {
            if (!unit) return false;
            const sm = this.game.sessionManager;
            if (!sm) return true;
            return sm.hasSeatedUnit(unit);
        },

        /**
         * Simulate _triggerSeatFlow (mirrors InteractionManager logic)
         */
        _triggerSeatFlow(unit) {
            if (!unit) return;
            const sm = this.game.sessionManager;
            if (!sm || sm.state.isOffline() || sm.state.isHost()) {
                this.inputFactory.select(unit.id, { skipCamera: true });
                return;
            }
            const seatPolicy = unit.seatPolicy || 'OPEN';
            if (seatPolicy === 'PIN_1DIGIT') {
                if (this.game.seatKeypadOverlay) {
                    this.game.seatKeypadOverlay.show(unit.id, () => {});
                }
            } else if (seatPolicy === 'OPEN') {
                sm.sendSeatReq({ targetUnitId: unit.id });
            }
        },

        /**
         * Simulate click on unit (mousedown + mouseup without drag)
         */
        simulateClick(unit) {
            this.mouseDownUnit = unit;
            this.state = 'MOUSE_DOWN';

            // MouseUp logic
            if (this.mouseDownUnit) {
                if (this._hasSeatAuthority(this.mouseDownUnit)) {
                    this.inputFactory.select(this.mouseDownUnit.id, { skipCamera: true });
                } else {
                    this._triggerSeatFlow(this.mouseDownUnit);
                }
            }
            this.state = 'IDLE';
            this.mouseDownUnit = null;
        },

        /**
         * Simulate drag on unit to start path drawing
         */
        simulateDrag(unit, event = { shiftKey: false }) {
            this.mouseDownUnit = unit;
            this.state = 'MOUSE_DOWN';

            // Drag threshold exceeded - decision point
            if (this._hasSeatAuthority(this.mouseDownUnit)) {
                this.state = 'DRAWING_PATH';
                return true; // Path drawing started
            } else {
                this.state = 'DRAGGING_TERRAIN';
                return false; // Fell through to terrain drag
            }
        },

        /**
         * Simulate shift-click for waypoint
         */
        simulateShiftClick(unit, terrain) {
            this.mouseDownTerrain = terrain;
            this.game.selectedUnit = unit;

            if (!this._hasSeatAuthority(unit)) {
                // Block - no waypoint
                return false;
            }

            this.inputFactory.move(unit.id, terrain);
            return true;
        }
    };
}

describe('Seat Authority System', () => {
    let sessionManager;
    let mockGame;
    let mockTransport;

    beforeEach(() => {
        mockGame = createMockGame();
        mockTransport = createMockTransport();
        sessionManager = new SessionManager(mockGame);
        sessionManager.setTransport(mockTransport);
        mockGame.sessionManager = sessionManager;
    });

    // ========================================
    // TEST GROUP 1: Keyboard Control Gate
    // ========================================
    describe('Keyboard Control Gate', () => {
        it('should block keyboard input when guest has no seat', () => {
            // Arrange: Setup as Guest at slot 2
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');

            // Unit controlled by slot 1 (NOT our slot)
            const unit = mockGame.units.find(u => u.id === 2);
            expect(unit.controllerSlot).toBe(1);

            // Act: Check seat authority (simulates Game.js keyboard gate logic)
            const hasSeat = sessionManager.hasSeatedUnit(unit);
            const keys = { forward: true, backward: false, left: true, right: false };
            const effectiveKeys = hasSeat ? keys : { forward: false, backward: false, left: false, right: false };

            // Assert: Keys should be blocked
            expect(hasSeat).toBe(false);
            expect(effectiveKeys.forward).toBe(false);
            expect(effectiveKeys.left).toBe(false);
        });

        it('should allow keyboard input when guest has seat', () => {
            // Arrange: Setup as Guest at slot 2
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');

            // Unit controlled by slot 2 (our slot)
            const unit = mockGame.units.find(u => u.id === 3);
            expect(unit.controllerSlot).toBe(2);

            // Act: Check seat authority
            const hasSeat = sessionManager.hasSeatedUnit(unit);
            const keys = { forward: true, backward: false, left: true, right: false };
            const effectiveKeys = hasSeat ? keys : { forward: false, backward: false, left: false, right: false };

            // Assert: Keys should pass through
            expect(hasSeat).toBe(true);
            expect(effectiveKeys.forward).toBe(true);
            expect(effectiveKeys.left).toBe(true);
        });

        it('should always allow keyboard input for host', () => {
            // Arrange: Setup as Host
            sessionManager.state.setAsHost('host-id', 'Test Session');

            // Any unit, even without controllerSlot
            const unit = mockGame.units.find(u => u.id === 1);
            expect(unit.controllerSlot).toBeNull();

            // Act: Check seat authority
            const hasSeat = sessionManager.hasSeatedUnit(unit);

            // Assert: Host always has authority
            expect(hasSeat).toBe(true);
        });

        it('should always allow keyboard input when offline', () => {
            // Arrange: Stay offline (default state)
            expect(sessionManager.state.isOffline()).toBe(true);

            const unit = mockGame.units.find(u => u.id === 1);

            // Act: Check seat authority
            const hasSeat = sessionManager.hasSeatedUnit(unit);

            // Assert: Offline always has authority
            expect(hasSeat).toBe(true);
        });
    });

    // ========================================
    // TEST GROUP 2: Selection Gate
    // ========================================
    describe('Selection Gate', () => {
        it('should not select locked unit for guest', () => {
            // Arrange: Setup as Guest at slot 2
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');
            sessionManager._sessionChannel = 'asterobia:session:host-id';

            const interactionManager = createMockInteractionManager(mockGame);

            // Unit controlled by slot 1 (NOT our slot)
            const unit = mockGame.units.find(u => u.id === 2);

            // Act: Click on locked unit
            interactionManager.simulateClick(unit);

            // Assert: inputFactory.select should NOT be called
            expect(interactionManager.inputFactory.select).not.toHaveBeenCalled();
        });

        it('should trigger seat flow for locked unit click (OPEN policy)', () => {
            // Arrange: Setup as Guest at slot 2
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');
            sessionManager._sessionChannel = 'asterobia:session:host-id';

            const interactionManager = createMockInteractionManager(mockGame);

            // Unit with no controller (OPEN policy) - we don't have seat yet
            const unit = mockGame.units.find(u => u.id === 1);
            expect(unit.seatPolicy).toBe('OPEN');
            expect(unit.controllerSlot).toBeNull();

            // Act: Click on unit without seat
            interactionManager.simulateClick(unit);

            // Assert: SEAT_REQ should be sent
            const sentMsgs = mockTransport.getSentMessages();
            const seatReq = sentMsgs.find(m => m.msg.type === 'SEAT_REQ');
            expect(seatReq).toBeDefined();
            expect(seatReq.msg.targetUnitId).toBe(1);
        });

        it('should show keypad for locked unit click (PIN_1DIGIT policy)', () => {
            // Arrange: Setup as Guest at slot 3
            sessionManager.state.setAsGuest('host-id', 3, 'guest-id', 'Guest');
            sessionManager._sessionChannel = 'asterobia:session:host-id';

            const interactionManager = createMockInteractionManager(mockGame);

            // Modify unit to not have our seat
            const unit = mockGame.units.find(u => u.id === 3);
            unit.controllerSlot = 1; // Different slot than ours

            // Act: Click on PIN-protected unit
            interactionManager.simulateClick(unit);

            // Assert: Keypad overlay should be shown
            expect(mockGame.seatKeypadOverlay.show).toHaveBeenCalled();
            expect(mockGame.seatKeypadOverlay.show.mock.calls[0][0]).toBe(3); // unit.id
        });

        it('should allow selection when guest has seat', () => {
            // Arrange: Setup as Guest at slot 2
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');

            const interactionManager = createMockInteractionManager(mockGame);

            // Unit controlled by slot 2 (our slot)
            const unit = mockGame.units.find(u => u.id === 3);
            expect(unit.controllerSlot).toBe(2);

            // Act: Click on unit we control
            interactionManager.simulateClick(unit);

            // Assert: inputFactory.select should be called
            expect(interactionManager.inputFactory.select).toHaveBeenCalledWith(3, { skipCamera: true });
        });
    });

    // ========================================
    // TEST GROUP 3: Path Command Gate
    // ========================================
    describe('Path Command Gate', () => {
        it('should reject path drawing without seat', () => {
            // Arrange: Setup as Guest at slot 2
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');

            const interactionManager = createMockInteractionManager(mockGame);

            // Unit controlled by slot 1 (NOT our slot)
            const unit = mockGame.units.find(u => u.id === 2);

            // Act: Try to drag on locked unit
            const pathStarted = interactionManager.simulateDrag(unit);

            // Assert: Should NOT enter DRAWING_PATH state
            expect(pathStarted).toBe(false);
            expect(interactionManager.state).toBe('DRAGGING_TERRAIN');
        });

        it('should allow path drawing with seat', () => {
            // Arrange: Setup as Guest at slot 2
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');

            const interactionManager = createMockInteractionManager(mockGame);

            // Unit controlled by slot 2 (our slot)
            const unit = mockGame.units.find(u => u.id === 3);
            expect(unit.controllerSlot).toBe(2);

            // Act: Drag on unit we control
            const pathStarted = interactionManager.simulateDrag(unit);

            // Assert: Should enter DRAWING_PATH state
            expect(pathStarted).toBe(true);
            expect(interactionManager.state).toBe('DRAWING_PATH');
        });

        it('should reject shift-click waypoint without seat', () => {
            // Arrange: Setup as Guest at slot 2
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');

            const interactionManager = createMockInteractionManager(mockGame);

            // Unit controlled by slot 1 (NOT our slot)
            const unit = mockGame.units.find(u => u.id === 2);
            const terrain = { x: 100, y: 0, z: 100 };

            // Act: Try shift-click on terrain for locked unit
            const waypointAdded = interactionManager.simulateShiftClick(unit, terrain);

            // Assert: inputFactory.move should NOT be called
            expect(waypointAdded).toBe(false);
            expect(interactionManager.inputFactory.move).not.toHaveBeenCalled();
        });

        it('should allow shift-click waypoint with seat', () => {
            // Arrange: Setup as Guest at slot 2
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');

            const interactionManager = createMockInteractionManager(mockGame);

            // Unit controlled by slot 2 (our slot)
            const unit = mockGame.units.find(u => u.id === 3);
            const terrain = { x: 100, y: 0, z: 100 };

            // Act: Shift-click on terrain for unit we control
            const waypointAdded = interactionManager.simulateShiftClick(unit, terrain);

            // Assert: inputFactory.move should be called
            expect(waypointAdded).toBe(true);
            expect(interactionManager.inputFactory.move).toHaveBeenCalledWith(3, terrain);
        });
    });

    // ========================================
    // TEST GROUP 4: INPUT_CMD Seat Validation (Host-side)
    // ========================================
    describe('INPUT_CMD Seat Validation (Host-side)', () => {
        beforeEach(() => {
            // Setup as Host
            mockGame.clientId = 'host-id';
            sessionManager.state.setAsHost('host-id', 'Test Session');
            sessionManager._sessionChannel = 'asterobia:session:host-id';

            // Add guest player at slot 2
            sessionManager.state.addPlayer({
                slot: 2,
                userId: 'guest-id',
                displayName: 'Guest',
                status: 'active'
            });
        });

        it('should reject INPUT_CMD when sender has no seat on target unit', () => {
            // Unit 2 is controlled by slot 1, not slot 2
            const unit = mockGame.units.find(u => u.id === 2);
            expect(unit.controllerSlot).toBe(1);

            const initialRejected = sessionManager._debugCounters.cmdRejectedAuth;

            // Act: Guest at slot 2 tries to command unit 2
            const inputCmd = {
                type: 'INPUT_CMD',
                senderId: 'guest-id',
                slot: 2,
                seq: 1,
                command: {
                    type: 'MOVE',
                    unitId: 2,
                    target: { x: 100, y: 100 }
                }
            };
            sessionManager._handleInputCmd(inputCmd);

            // Assert: Command should be rejected
            expect(sessionManager._debugCounters.cmdRejectedAuth).toBe(initialRejected + 1);
            expect(sessionManager.inputBuffer.length).toBe(0);
        });

        it('should accept INPUT_CMD when sender has seat on target unit', () => {
            // Unit 3 is controlled by slot 2
            const unit = mockGame.units.find(u => u.id === 3);
            expect(unit.controllerSlot).toBe(2);

            // Act: Guest at slot 2 commands unit 3
            const inputCmd = {
                type: 'INPUT_CMD',
                senderId: 'guest-id',
                slot: 2,
                seq: 1,
                command: {
                    type: 'MOVE',
                    unitId: 3,
                    target: { x: 100, y: 100 }
                }
            };
            sessionManager._handleInputCmd(inputCmd);

            // Assert: Command should be buffered
            expect(sessionManager.inputBuffer.length).toBe(1);
        });

        it('should accept INPUT_CMD for units with no controller (unseated)', () => {
            // Unit 1 has controllerSlot = null (anyone can potentially command)
            const unit = mockGame.units.find(u => u.id === 1);
            expect(unit.controllerSlot).toBeNull();

            // Act: Guest at slot 2 commands unseated unit
            const inputCmd = {
                type: 'INPUT_CMD',
                senderId: 'guest-id',
                slot: 2,
                seq: 1,
                command: {
                    type: 'MOVE',
                    unitId: 1,
                    target: { x: 100, y: 100 }
                }
            };
            sessionManager._handleInputCmd(inputCmd);

            // Assert: Command should be buffered (no specific seat required)
            expect(sessionManager.inputBuffer.length).toBe(1);
        });
    });

    // ========================================
    // TEST GROUP 5: hasSeatedUnit Edge Cases
    // ========================================
    describe('hasSeatedUnit Edge Cases', () => {
        it('should return false for null unit', () => {
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');
            expect(sessionManager.hasSeatedUnit(null)).toBe(false);
        });

        it('should return false for undefined unit', () => {
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');
            expect(sessionManager.hasSeatedUnit(undefined)).toBe(false);
        });

        it('should handle unit with undefined controllerSlot', () => {
            sessionManager.state.setAsGuest('host-id', 2, 'guest-id', 'Guest');
            const unit = { id: 99 }; // No controllerSlot property
            expect(sessionManager.hasSeatedUnit(unit)).toBe(false);
        });

        it('should return true for host even with null controllerSlot', () => {
            sessionManager.state.setAsHost('host-id', 'Test Session');
            const unit = { id: 1, controllerSlot: null };
            expect(sessionManager.hasSeatedUnit(unit)).toBe(true);
        });
    });
});
