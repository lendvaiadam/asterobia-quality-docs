/**
 * WebSocketTransport + WsRelay Integration Tests
 *
 * Tests the full transport layer: WebSocketTransport -> WsRelay -> WebSocketTransport.
 * Unlike ws-relay.test.js (which uses raw ws clients), these tests use the actual
 * WebSocketTransport class to verify the channel API works end-to-end.
 *
 * Key scenarios:
 * - Channel join + broadcast message delivery
 * - No double dispatch (channel callback XOR global handler)
 * - HOST_ANNOUNCE -> JOIN_REQ -> JOIN_ACK flow via transport layer
 * - _ensureConnected auto-reconnect after WS drop
 * - Connection failure detection (relay not running)
 * - wireSendCount accuracy
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import { WsRelay } from '../../../server/WsRelay.js';
import { WebSocketTransport } from '../../../src/SimCore/transport/WebSocketTransport.js';
import { TransportState } from '../../../src/SimCore/transport/ITransport.js';

// Make ws library's WebSocket available as global for WebSocketTransport
// (it uses `new WebSocket(url)` expecting the browser global)
globalThis.WebSocket = WebSocket;

describe('WebSocketTransport + WsRelay Integration', () => {
    let httpServer;
    let relay;
    let port;
    /** @type {WebSocketTransport[]} */
    let transports = [];

    beforeEach(async () => {
        httpServer = http.createServer();
        relay = new WsRelay();
        relay.startOnServer(httpServer);

        await new Promise((resolve) => {
            httpServer.listen(0, () => {
                port = httpServer.address().port;
                resolve();
            });
        });

        transports = [];
    });

    afterEach(async () => {
        for (const t of transports) {
            t.disconnect();
        }
        transports = [];
        await relay.stop();
        await new Promise((resolve) => httpServer.close(resolve));
    });

    /**
     * Create a WebSocketTransport connected to the test relay.
     * Calls connect() and waits for the WS to be OPEN.
     */
    async function createTransport(opts = {}) {
        const t = new WebSocketTransport({
            url: `ws://localhost:${port}`,
            connectTimeoutMs: 3000,
            ...opts
        });
        t.connect();
        transports.push(t);

        // Wait for connection to open
        await new Promise((resolve, reject) => {
            const maxWait = setTimeout(() => reject(new Error('Transport connect timeout')), 3000);
            const check = setInterval(() => {
                if (t._state === TransportState.CONNECTED) {
                    clearInterval(check);
                    clearTimeout(maxWait);
                    resolve();
                } else if (t._state === TransportState.ERROR) {
                    clearInterval(check);
                    clearTimeout(maxWait);
                    reject(new Error('Transport connect error'));
                }
            }, 10);
        });

        return t;
    }

    // ============================================
    // CONNECTION & STATE
    // ============================================

    it('should connect to relay and report CONNECTED state', async () => {
        const t = await createTransport();
        expect(t._state).toBe(TransportState.CONNECTED);
        expect(relay.clientCount).toBe(1);
    });

    it('should provide accurate debug info via getDebugInfo()', async () => {
        const t = await createTransport();
        const info = t.getDebugInfo();

        expect(info.type).toBe('websocket');
        expect(info.state).toBe(TransportState.CONNECTED);
        expect(info.wsReadyState).toBe(1); // OPEN
        expect(info.wsReadyStateLabel).toBe('OPEN');
        expect(info.subscribedChannels).toEqual([]);
        expect(info.pendingMessageCount).toBe(0);
        expect(info.wireSendCount).toBe(0);
    });

    // ============================================
    // CHANNEL COMMUNICATION
    // ============================================

    it('should deliver broadcast messages between two transports', async () => {
        const tA = await createTransport();
        const tB = await createTransport();

        let receivedOnB = null;
        await tA.joinChannel('test-ch', () => {});
        await tB.joinChannel('test-ch', (msg) => { receivedOnB = msg; });

        await new Promise(r => setTimeout(r, 50));

        await tA.broadcastToChannel('test-ch', { type: 'PING', data: 42 });

        await new Promise(r => setTimeout(r, 200));
        expect(receivedOnB).toBeTruthy();
        expect(receivedOnB.type).toBe('PING');
        expect(receivedOnB.data).toBe(42);
    });

    it('should NOT echo broadcasts back to sender', async () => {
        const tA = await createTransport();
        const tB = await createTransport();

        let receivedOnA = false;
        let receivedOnB = false;
        await tA.joinChannel('echo-test', () => { receivedOnA = true; });
        await tB.joinChannel('echo-test', () => { receivedOnB = true; });

        await new Promise(r => setTimeout(r, 50));

        await tA.broadcastToChannel('echo-test', { test: true });

        await new Promise(r => setTimeout(r, 200));
        expect(receivedOnB).toBe(true);
        expect(receivedOnA).toBe(false);
    });

    it('should isolate channels (message only reaches correct subscribers)', async () => {
        const tA = await createTransport();
        const tB = await createTransport();
        const tC = await createTransport();

        let receivedOnB = false;
        let receivedOnC = null;

        await tA.joinChannel('room-1', () => {});
        await tB.joinChannel('room-2', () => { receivedOnB = true; });
        await tC.joinChannel('room-1', (msg) => { receivedOnC = msg; });

        await new Promise(r => setTimeout(r, 50));

        await tA.broadcastToChannel('room-1', { from: 'A' });

        await new Promise(r => setTimeout(r, 200));
        expect(receivedOnC).toBeTruthy();
        expect(receivedOnC.from).toBe('A');
        expect(receivedOnB).toBe(false);
    });

    // ============================================
    // DOUBLE DISPATCH FIX (Critical regression test)
    // ============================================

    it('should dispatch message via channel callback only (NOT also global handler)', async () => {
        const tA = await createTransport();
        const tB = await createTransport();

        let channelCallCount = 0;
        let globalCallCount = 0;

        await tB.joinChannel('dispatch-test', () => { channelCallCount++; });
        tB.onMessage(() => { globalCallCount++; });

        await tA.joinChannel('dispatch-test', () => {});
        await new Promise(r => setTimeout(r, 50));

        await tA.broadcastToChannel('dispatch-test', { test: 1 });

        await new Promise(r => setTimeout(r, 200));

        expect(channelCallCount).toBe(1);
        expect(globalCallCount).toBe(0);
    });

    it('should fall back to global handler when no channel callback exists', async () => {
        const tA = await createTransport();
        const tB = await createTransport();

        let globalCallCount = 0;
        let globalMsg = null;

        tB.onMessage((msg) => { globalCallCount++; globalMsg = msg; });

        await tB.joinChannel('fallback-test');
        await tA.joinChannel('fallback-test', () => {});
        await new Promise(r => setTimeout(r, 50));

        await tA.broadcastToChannel('fallback-test', { type: 'HELLO' });

        await new Promise(r => setTimeout(r, 200));

        expect(globalCallCount).toBe(1);
        expect(globalMsg.type).toBe('HELLO');
    });

    // ============================================
    // HOST → JOIN FLOW (End-to-end via transport layer)
    // ============================================

    it('should handle full HOST_ANNOUNCE → JOIN_REQ → JOIN_ACK via transport layer', async () => {
        const hostTransport = await createTransport();
        const guestTransport = await createTransport();

        const lobbyChannel = 'asterobia:lobby';
        const sessionChannel = 'asterobia:session:host123';

        const hostMessages = [];
        const guestMessages = [];

        await hostTransport.joinChannel(lobbyChannel, (msg) => hostMessages.push(msg));
        await hostTransport.joinChannel(sessionChannel, (msg) => hostMessages.push(msg));

        await guestTransport.joinChannel(lobbyChannel, (msg) => guestMessages.push(msg));
        await guestTransport.joinChannel(sessionChannel, (msg) => guestMessages.push(msg));

        await new Promise(r => setTimeout(r, 50));

        // Step 1: Host announces on lobby
        await hostTransport.broadcastToChannel(lobbyChannel, {
            type: 'HOST_ANNOUNCE', hostId: 'host123', sessionName: 'Test Room'
        });
        await new Promise(r => setTimeout(r, 100));
        expect(guestMessages.length).toBe(1);
        expect(guestMessages[0].type).toBe('HOST_ANNOUNCE');

        // Step 2: Guest sends JOIN_REQ on session channel
        await guestTransport.broadcastToChannel(sessionChannel, {
            type: 'JOIN_REQ', guestId: 'guest456', displayName: 'Player 2', protocolVersion: '0.13.0'
        });
        await new Promise(r => setTimeout(r, 100));
        expect(hostMessages.length).toBe(1);
        expect(hostMessages[0].type).toBe('JOIN_REQ');

        // Step 3: Host sends JOIN_ACK
        await hostTransport.broadcastToChannel(sessionChannel, {
            type: 'JOIN_ACK', accepted: true, assignedSlot: 1, guestId: 'guest456'
        });
        await new Promise(r => setTimeout(r, 100));
        expect(guestMessages.length).toBe(2);
        expect(guestMessages[1].type).toBe('JOIN_ACK');
        expect(guestMessages[1].accepted).toBe(true);
    });

    // ============================================
    // _ensureConnected + AUTO-RECONNECT
    // ============================================

    it('should auto-reconnect when joinChannel is called after WS drops', async () => {
        const t = await createTransport();
        expect(t._state).toBe(TransportState.CONNECTED);

        // Force-close the underlying WS (simulates network drop)
        t._ws.close();
        await new Promise(r => setTimeout(r, 100));
        expect(t._state).toBe(TransportState.DISCONNECTED);

        // joinChannel should trigger auto-reconnect via _ensureConnected
        let receivedMsg = null;
        await t.joinChannel('reconnect-test', (msg) => { receivedMsg = msg; });

        // After joinChannel, WS should be re-connected
        expect(t._state).toBe(TransportState.CONNECTED);
        expect(t._ws.readyState).toBe(1);

        // Verify the re-connected transport can receive messages
        const t2 = await createTransport();
        await t2.joinChannel('reconnect-test', () => {});
        await new Promise(r => setTimeout(r, 50));

        await t2.broadcastToChannel('reconnect-test', { type: 'AFTER_RECONNECT' });
        await new Promise(r => setTimeout(r, 200));

        expect(receivedMsg).toBeTruthy();
        expect(receivedMsg.type).toBe('AFTER_RECONNECT');
    });

    it('should auto-reconnect when broadcastToChannel is called after WS drops', async () => {
        const tA = await createTransport();
        const tB = await createTransport();

        let receivedOnB = null;
        await tA.joinChannel('bcast-reconnect', () => {});
        await tB.joinChannel('bcast-reconnect', (msg) => { receivedOnB = msg; });
        await new Promise(r => setTimeout(r, 50));

        // Force-close A's WS (simulates network drop)
        tA._ws.close();
        await new Promise(r => setTimeout(r, 100));
        expect(tA._state).toBe(TransportState.DISCONNECTED);

        // broadcastToChannel should auto-reconnect and send
        await tA.broadcastToChannel('bcast-reconnect', { type: 'RECOVERED' });

        expect(tA._state).toBe(TransportState.CONNECTED);

        await new Promise(r => setTimeout(r, 200));
        expect(receivedOnB).toBeTruthy();
        expect(receivedOnB.type).toBe('RECOVERED');
    });

    it('should flush pending messages after reconnect (queue-then-flush)', async () => {
        const t = await createTransport();

        // Subscribe to a channel while connected
        await t.joinChannel('flush-test', () => {});
        await new Promise(r => setTimeout(r, 50));

        // Force disconnect
        t._ws.close();
        await new Promise(r => setTimeout(r, 100));
        expect(t._state).toBe(TransportState.DISCONNECTED);

        // Queue a broadcast while disconnected (bypass _ensureConnected by using _sendWsMessage directly)
        t._sendWsMessage({ type: 'broadcast', channel: 'flush-test', payload: { queued: true } });
        expect(t._pendingMessages.length).toBe(1);

        // Now reconnect explicitly
        t.connect();
        await new Promise((resolve, reject) => {
            const maxWait = setTimeout(() => reject(new Error('Reconnect timeout')), 3000);
            const check = setInterval(() => {
                if (t._state === TransportState.CONNECTED) {
                    clearInterval(check);
                    clearTimeout(maxWait);
                    resolve();
                }
            }, 10);
        });

        // Pending should be flushed
        expect(t._pendingMessages.length).toBe(0);
        expect(t._wireSendCount).toBeGreaterThan(0);
    });

    it('should throw when intentionally disconnected (no auto-reconnect)', async () => {
        const t = await createTransport();

        // Intentional disconnect
        t.disconnect();
        expect(t._state).toBe(TransportState.DISCONNECTED);
        expect(t._intentionalDisconnect).toBe(true);

        // joinChannel should throw, not auto-reconnect
        await expect(t.joinChannel('should-fail', () => {}))
            .rejects.toThrow('intentionally disconnected');
    });

    it('should auto-connect on first joinChannel call (no explicit connect needed)', async () => {
        // Create transport WITHOUT calling connect()
        const t = new WebSocketTransport({
            url: `ws://localhost:${port}`,
            connectTimeoutMs: 3000
        });
        transports.push(t);

        expect(t._state).toBe(TransportState.DISCONNECTED);

        // joinChannel should auto-connect via _ensureConnected
        await t.joinChannel('auto-connect-test', () => {});

        expect(t._state).toBe(TransportState.CONNECTED);
        expect(t.isJoinedToChannel('auto-connect-test')).toBe(true);
    });

    // ============================================
    // CONNECTION FAILURE
    // ============================================

    it('should throw fast when relay is not running', async () => {
        // Use a port that definitely has no relay
        const deadPort = port + 999;
        const t = new WebSocketTransport({
            url: `ws://localhost:${deadPort}`,
            connectTimeoutMs: 2000
        });
        transports.push(t);

        // joinChannel should fail because relay is not running
        await expect(t.joinChannel('dead-relay', () => {}))
            .rejects.toThrow(/Connection failed|Connection timeout/);
    });

    // ============================================
    // EDGE CASES
    // ============================================

    it('should track subscribed channels correctly', async () => {
        const t = await createTransport();

        expect(t.isJoinedToChannel('ch1')).toBe(false);

        await t.joinChannel('ch1', () => {});
        expect(t.isJoinedToChannel('ch1')).toBe(true);

        await t.leaveChannel('ch1');
        expect(t.isJoinedToChannel('ch1')).toBe(false);
    });

    it('should reflect channel state in getDebugInfo()', async () => {
        const t = await createTransport();

        await t.joinChannel('lobby', () => {});
        await t.joinChannel('session', () => {});

        const info = t.getDebugInfo();
        expect(info.subscribedChannels).toEqual(['lobby', 'session']);
        expect(info.channelCallbackCount).toBe(2);
    });

    it('should track wireSendCount for actual wire sends', async () => {
        const t = await createTransport();

        expect(t._wireSendCount).toBe(0);

        await t.joinChannel('count-test', () => {});
        // subscribe frame sent on wire
        expect(t._wireSendCount).toBe(1);

        await t.broadcastToChannel('count-test', { data: 1 });
        // broadcast frame sent on wire
        expect(t._wireSendCount).toBe(2);
    });
});
