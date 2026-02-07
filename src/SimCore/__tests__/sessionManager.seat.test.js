/**
 * sessionManager.seat.test.js - Unit tests for Seat Acquisition and PIN Challenge
 *
 * Tests: GAP-0 Seat Request Protocol
 * - SEAT_REQ / SEAT_ACK message flow
 * - seatPolicy: OPEN, PIN_1DIGIT
 * - Cooldown after failed PIN attempts
 * - Occupied unit rejection
 * - INPUT_CMD without seat (auth rejection)
 *
 * Reference: GAP-0 Seat Acquisition Spec
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../multiplayer/SessionManager.js';
import { NetworkRole } from '../multiplayer/NetworkRole.js';
import { MSG } from '../multiplayer/MessageTypes.js';

/**
 * Mock Game object with units for seat testing
 * Uses both selectedBySlot (canonical) and controllerSlot (SessionManager compat) in sync
 */
function createMockGame() {
    return {
        clientId: 'host-id',
        _isDevMode: false,
        simLoop: { tickCount: 100 },
        units: [
            { id: 1, ownerSlot: 0, selectedBySlot: null, controllerSlot: null, seatPolicy: 'OPEN' },
            { id: 2, ownerSlot: 0, selectedBySlot: null, controllerSlot: null, seatPolicy: 'PIN_1DIGIT', seatPinDigit: 5 },
            { id: 3, ownerSlot: 0, selectedBySlot: 1, controllerSlot: 1, seatPolicy: 'OPEN' } // Already occupied
        ],
        stateSurface: { serialize: () => ({}), deserialize: vi.fn() }
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

describe('SessionManager Seat Acquisition (GAP-0)', () => {
    let sessionManager;
    let mockGame;
    let mockTransport;

    beforeEach(() => {
        mockGame = createMockGame();
        mockTransport = createMockTransport();
        sessionManager = new SessionManager(mockGame);
        sessionManager.setTransport(mockTransport);

        // Setup Host state
        sessionManager.state.setAsHost('host-id', 'Test Session');
        sessionManager._sessionChannel = 'asterobia:session:host-id';

        // Add a guest player at slot 2
        sessionManager.state.addPlayer({
            slot: 2,
            userId: 'guest-id',
            displayName: 'Guest Player',
            status: 'active'
        });
    });

    // ========================================
    // TEST 1: SEAT_REQ with seatPolicy='OPEN'
    // ========================================
    describe('SEAT_REQ with seatPolicy=OPEN', () => {
        it('should grant seat and send SEAT_ACK when seatPolicy is OPEN', () => {
            // Arrange
            const seatReq = {
                type: MSG.SEAT_REQ || 'SEAT_REQ',
                senderId: 'guest-id',
                targetUnitId: 1, // Unit with seatPolicy='OPEN'
                requesterSlot: 2,
                auth: null
            };

            // Act
            sessionManager._handleSeatReq?.(seatReq);

            // Assert
            const unit = mockGame.units.find(u => u.id === 1);
            expect(unit.selectedBySlot).toBe(2);

            // Check SEAT_ACK was sent
            const sentMsgs = mockTransport.getSentMessages();
            const ack = sentMsgs.find(m => m.msg.type === 'SEAT_ACK');
            expect(ack).toBeDefined();
            expect(ack.msg.controllerSlot).toBe(2);
            expect(ack.msg.targetUnitId).toBe(1);
        });

        it('should assign controllerSlot to the requester slot', () => {
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 1,
                auth: null
            };

            sessionManager._handleSeatReq?.(seatReq);

            const unit = mockGame.units.find(u => u.id === 1);
            expect(unit.selectedBySlot).toBe(2);
        });
    });

    // ========================================
    // TEST 2: SEAT_REQ with seatPolicy='PIN_1DIGIT' - Correct PIN
    // ========================================
    describe('SEAT_REQ with seatPolicy=PIN_1DIGIT - Correct PIN', () => {
        it('should grant seat when correct PIN is provided', () => {
            // Arrange - Unit 2 has seatPolicy='PIN_1DIGIT', seatPinDigit=5
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 5 }
            };

            // Act
            sessionManager._handleSeatReq?.(seatReq);

            // Assert
            const unit = mockGame.units.find(u => u.id === 2);
            expect(unit.selectedBySlot).toBe(2);

            const sentMsgs = mockTransport.getSentMessages();
            const ack = sentMsgs.find(m => m.msg.type === 'SEAT_ACK');
            expect(ack).toBeDefined();
            expect(ack.msg.controllerSlot).toBe(2);
        });

        it('should send SEAT_ACK with controllerSlot on correct PIN', () => {
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 5 }
            };

            sessionManager._handleSeatReq?.(seatReq);

            const sentMsgs = mockTransport.getSentMessages();
            const ack = sentMsgs.find(m => m.msg.type === 'SEAT_ACK');
            expect(ack.msg.controllerSlot).toBe(2);
            expect(ack.msg.targetUnitId).toBe(2);
        });
    });

    // ========================================
    // TEST 3: SEAT_REQ with BAD_PIN
    // ========================================
    describe('SEAT_REQ with BAD_PIN', () => {
        it('should reject with reason=BAD_PIN when wrong PIN provided', () => {
            // Arrange - Unit 2 has seatPinDigit=5, guest guesses 3
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            };

            // Act
            sessionManager._handleSeatReq?.(seatReq);

            // Assert - Unit should NOT be seated
            const unit = mockGame.units.find(u => u.id === 2);
            expect(unit.selectedBySlot).toBeNull();

            // Check SEAT_REJECT was sent
            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject).toBeDefined();
            expect(reject.msg.reason).toBe('BAD_PIN');
        });

        it('should include retryAfterMs=250 on first BAD_PIN', () => {
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            };

            sessionManager._handleSeatReq?.(seatReq);

            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject.msg.retryAfterMs).toBe(250);
        });
    });

    // ========================================
    // TEST 4: SEAT_REQ during COOLDOWN
    // ========================================
    describe('SEAT_REQ during COOLDOWN', () => {
        it('should reject with reason=COOLDOWN when retrying too soon', () => {
            // First attempt - BAD_PIN
            const seatReq1 = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            };
            sessionManager._handleSeatReq?.(seatReq1);
            mockTransport.clearSentMessages();

            // Immediate retry (within 250ms cooldown)
            const seatReq2 = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 5 } // Even correct PIN
            };
            sessionManager._handleSeatReq?.(seatReq2);

            // Assert - Should be rejected due to cooldown
            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject).toBeDefined();
            expect(reject.msg.reason).toBe('COOLDOWN');
        });

        it('should include remaining retryAfterMs in COOLDOWN rejection', () => {
            // First attempt - BAD_PIN
            const seatReq1 = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            };
            sessionManager._handleSeatReq?.(seatReq1);
            mockTransport.clearSentMessages();

            // Immediate retry
            const seatReq2 = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 5 }
            };
            sessionManager._handleSeatReq?.(seatReq2);

            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject.msg.retryAfterMs).toBeDefined();
            expect(reject.msg.retryAfterMs).toBeGreaterThan(0);
        });
    });

    // ========================================
    // TEST 5: SEAT_REQ for OCCUPIED unit
    // ========================================
    describe('SEAT_REQ for OCCUPIED unit', () => {
        it('should reject with reason=OCCUPIED when unit already has controller', () => {
            // Arrange - Unit 3 has controllerSlot=1 (already occupied)
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 3, // Already has controllerSlot=1
                auth: null
            };

            // Act
            sessionManager._handleSeatReq?.(seatReq);

            // Assert
            const unit = mockGame.units.find(u => u.id === 3);
            expect(unit.selectedBySlot).toBe(1); // Unchanged

            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject).toBeDefined();
            expect(reject.msg.reason).toBe('OCCUPIED');
        });

        it('should not change selectedBySlot when unit is OCCUPIED', () => {
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 3,
                auth: null
            };

            const originalController = mockGame.units.find(u => u.id === 3).selectedBySlot;
            sessionManager._handleSeatReq?.(seatReq);
            const newController = mockGame.units.find(u => u.id === 3).selectedBySlot;

            expect(newController).toBe(originalController);
        });
    });

    // ========================================
    // TEST 6: INPUT_CMD without seat (auth rejection)
    // ========================================
    describe('INPUT_CMD without seat (auth rejection)', () => {
        it('should reject INPUT_CMD and increment cmdRejectedAuth when sender has no seat', () => {
            // Arrange - Unit 1 has selectedBySlot=null initially, but let's set it to slot 1
            // Guest at slot 2 tries to control it
            mockGame.units[0].selectedBySlot = 1; // Slot 1 controls unit 1

            const initialRejectedAuth = sessionManager._debugCounters.cmdRejectedAuth;

            const inputCmd = {
                type: MSG.INPUT_CMD,
                senderId: 'guest-id',
                slot: 2, // Guest is at slot 2
                seq: 1,
                command: {
                    type: 'MOVE',
                    unitId: 1, // Trying to control unit controlled by slot 1
                    target: { x: 100, y: 100 }
                }
            };

            // Act - This should be rejected because slot 2 doesn't have seat on unit 1
            sessionManager._handleInputCmd?.(inputCmd);

            // Assert
            expect(sessionManager._debugCounters.cmdRejectedAuth).toBe(initialRejectedAuth + 1);
            expect(sessionManager.inputBuffer.length).toBe(0);
        });

        it('should allow INPUT_CMD when sender has valid seat', () => {
            // Arrange - Give slot 2 control of unit 1
            mockGame.units[0].selectedBySlot = 2;

            const inputCmd = {
                type: MSG.INPUT_CMD,
                senderId: 'guest-id',
                slot: 2,
                seq: 1,
                command: {
                    type: 'MOVE',
                    unitId: 1,
                    target: { x: 100, y: 100 }
                }
            };

            // Act
            sessionManager._handleInputCmd?.(inputCmd);

            // Assert - Should be buffered
            expect(sessionManager.inputBuffer.length).toBe(1);
        });
    });

    // ========================================
    // TEST 7: Progressive Cooldown
    // ========================================
    describe('Progressive Cooldown', () => {
        it('should enforce 250ms cooldown after first BAD_PIN', () => {
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            };

            sessionManager._handleSeatReq?.(seatReq);

            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject.msg.retryAfterMs).toBe(250);
        });

        it('should enforce 500ms cooldown after second BAD_PIN', () => {
            // We need to simulate time passing for this test
            vi.useFakeTimers();

            // First BAD_PIN
            const seatReq1 = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            };
            sessionManager._handleSeatReq?.(seatReq1);

            // Wait for cooldown to expire
            vi.advanceTimersByTime(300);
            mockTransport.clearSentMessages();

            // Second BAD_PIN
            const seatReq2 = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            };
            sessionManager._handleSeatReq?.(seatReq2);

            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject.msg.retryAfterMs).toBe(500);

            vi.useRealTimers();
        });

        it('should enforce 1000ms cooldown after third BAD_PIN', () => {
            vi.useFakeTimers();

            // First BAD_PIN
            sessionManager._handleSeatReq?.({
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            });
            vi.advanceTimersByTime(300);

            // Second BAD_PIN
            sessionManager._handleSeatReq?.({
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            });
            vi.advanceTimersByTime(600);

            mockTransport.clearSentMessages();

            // Third BAD_PIN
            sessionManager._handleSeatReq?.({
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            });

            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject.msg.retryAfterMs).toBe(1000);

            vi.useRealTimers();
        });

        it('should cap cooldown at 2000ms after fourth+ BAD_PIN', () => {
            vi.useFakeTimers();

            // First through third BAD_PIN
            for (let i = 0; i < 3; i++) {
                sessionManager._handleSeatReq?.({
                    type: 'SEAT_REQ',
                    senderId: 'guest-id',
                    requesterSlot: 2,
                    targetUnitId: 2,
                    auth: { method: 'PIN_1DIGIT', guess: 3 }
                });
                vi.advanceTimersByTime(1500); // Wait for cooldown
            }

            mockTransport.clearSentMessages();

            // Fourth BAD_PIN
            sessionManager._handleSeatReq?.({
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            });

            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject.msg.retryAfterMs).toBe(2000);

            vi.useRealTimers();
        });

        it('should maintain progressive cooldown pattern: 250, 500, 1000, 2000 (capped)', () => {
            const expectedCooldowns = [250, 500, 1000, 2000, 2000]; // Fifth should also be 2000

            vi.useFakeTimers();

            for (let i = 0; i < expectedCooldowns.length; i++) {
                mockTransport.clearSentMessages();

                sessionManager._handleSeatReq?.({
                    type: 'SEAT_REQ',
                    senderId: 'guest-id',
                    requesterSlot: 2,
                    targetUnitId: 2,
                    auth: { method: 'PIN_1DIGIT', guess: 3 }
                });

                const sentMsgs = mockTransport.getSentMessages();
                const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');

                expect(reject.msg.retryAfterMs).toBe(expectedCooldowns[i]);

                // Wait for cooldown to expire before next attempt
                vi.advanceTimersByTime(expectedCooldowns[i] + 100);
            }

            vi.useRealTimers();
        });
    });

    // ========================================
    // Additional Edge Cases
    // ========================================
    describe('Edge Cases', () => {
        it('should ignore SEAT_REQ if not HOST', () => {
            // Change to GUEST role
            sessionManager.state.role = NetworkRole.GUEST;

            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 1,
                auth: null
            };

            sessionManager._handleSeatReq?.(seatReq);

            // No response should be sent
            const sentMsgs = mockTransport.getSentMessages();
            const ack = sentMsgs.find(m => m.msg.type === 'SEAT_ACK');
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(ack).toBeUndefined();
            expect(reject).toBeUndefined();
        });

        it('should reject SEAT_REQ for non-existent unit', () => {
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 999, // Does not exist
                auth: null
            };

            sessionManager._handleSeatReq?.(seatReq);

            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject).toBeDefined();
            // Implementation sends 'LOCKED' for non-existent units
            expect(reject.msg.reason).toBe('LOCKED');
        });

        it('should grant SEAT_REQ for valid slot even with unknown senderId', () => {
            // Note: Current implementation doesn't validate senderId against session players
            // It only checks requesterSlot. This test verifies the current behavior.
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'unknown-id', // Not in session, but slot 2 is valid
                requesterSlot: 2,
                targetUnitId: 1,
                auth: null
            };

            sessionManager._handleSeatReq?.(seatReq);

            // Unit 1 has seatPolicy='OPEN', so should be granted
            const unit = mockGame.units.find(u => u.id === 1);
            expect(unit.selectedBySlot).toBe(2);
        });

        it('should require PIN auth when seatPolicy is PIN_1DIGIT and no auth provided', () => {
            const seatReq = {
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2, // PIN_1DIGIT unit
                auth: null // No auth provided
            };

            sessionManager._handleSeatReq?.(seatReq);

            const sentMsgs = mockTransport.getSentMessages();
            const reject = sentMsgs.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject).toBeDefined();
            // Implementation sends 'LOCKED' when no auth provided for PIN unit
            expect(reject.msg.reason).toBe('LOCKED');
        });

        it('should reset cooldown after successful seat acquisition', () => {
            vi.useFakeTimers();

            // First BAD_PIN
            sessionManager._handleSeatReq?.({
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            });
            vi.advanceTimersByTime(300);

            mockTransport.clearSentMessages();

            // Correct PIN
            sessionManager._handleSeatReq?.({
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 5 }
            });

            const sentMsgs = mockTransport.getSentMessages();
            const ack = sentMsgs.find(m => m.msg.type === 'SEAT_ACK');
            expect(ack).toBeDefined();
            expect(ack.msg.controllerSlot).toBe(2);

            // Release seat for next test
            mockGame.units[1].selectedBySlot = null;
            mockTransport.clearSentMessages();

            // Now another BAD_PIN should have reset cooldown to 250ms
            sessionManager._handleSeatReq?.({
                type: 'SEAT_REQ',
                senderId: 'guest-id',
                requesterSlot: 2,
                targetUnitId: 2,
                auth: { method: 'PIN_1DIGIT', guess: 3 }
            });

            const sentMsgs2 = mockTransport.getSentMessages();
            const reject = sentMsgs2.find(m => m.msg.type === 'SEAT_REJECT');
            expect(reject.msg.retryAfterMs).toBe(250); // Reset to initial

            vi.useRealTimers();
        });
    });
});
