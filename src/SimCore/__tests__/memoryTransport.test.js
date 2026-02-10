/**
 * MemoryTransport Tests (R013)
 *
 * Tests the in-process transport system: MemoryTransportHub + MemoryTransportEndpoint.
 * Verifies the channel-based API that SessionManager expects works correctly
 * without a real network.
 *
 * Run: npx vitest run
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    MemoryTransportHub,
    MemoryTransportEndpoint,
    TransportBase,
    TransportState
} from '../transport/index.js';

// ========================================
// Hub Creation & Endpoint Registration
// ========================================

describe('MemoryTransportHub', () => {
    let hub;

    beforeEach(() => {
        hub = new MemoryTransportHub();
    });

    it('creates with empty state', () => {
        expect(hub.endpoints.size).toBe(0);
        expect(hub.channels.size).toBe(0);
    });

    it('creates named endpoints', () => {
        const host = hub.createEndpoint('host');
        const guest = hub.createEndpoint('guest');

        expect(host).toBeInstanceOf(MemoryTransportEndpoint);
        expect(guest).toBeInstanceOf(MemoryTransportEndpoint);
        expect(host.name).toBe('host');
        expect(guest.name).toBe('guest');
        expect(hub.endpoints.size).toBe(2);
    });

    it('rejects duplicate endpoint names', () => {
        hub.createEndpoint('host');
        expect(() => hub.createEndpoint('host')).toThrow("endpoint 'host' already exists");
    });

    it('removes endpoints and cleans up subscriptions', async () => {
        const host = hub.createEndpoint('host');
        const guest = hub.createEndpoint('guest');

        await host.joinChannel('lobby', () => {});
        await guest.joinChannel('lobby', () => {});

        expect(hub.channels.get('lobby').size).toBe(2);

        hub.removeEndpoint('host');

        expect(hub.endpoints.size).toBe(1);
        expect(hub.channels.get('lobby').size).toBe(1);
        expect(hub.channels.get('lobby').has('host')).toBe(false);
    });

    it('reset clears all state', async () => {
        const host = hub.createEndpoint('host');
        await host.joinChannel('lobby', () => {});

        hub.reset();

        expect(hub.endpoints.size).toBe(0);
        expect(hub.channels.size).toBe(0);
    });

    it('supports message logging when enabled', async () => {
        hub = new MemoryTransportHub({ enableLog: true });
        const host = hub.createEndpoint('host');
        const guest = hub.createEndpoint('guest');

        await host.joinChannel('lobby', () => {});
        await guest.joinChannel('lobby', () => {});

        await host.broadcastToChannel('lobby', { type: 'TEST' });

        const log = hub.getMessageLog();
        expect(log.length).toBe(1);
        expect(log[0].channel).toBe('lobby');
        expect(log[0].msg.type).toBe('TEST');
        expect(log[0].senderName).toBe('host');
    });
});

// ========================================
// Endpoint - Extends TransportBase
// ========================================

describe('MemoryTransportEndpoint extends TransportBase', () => {
    let hub;

    beforeEach(() => {
        hub = new MemoryTransportHub();
    });

    it('is an instance of TransportBase', () => {
        const ep = hub.createEndpoint('test');
        expect(ep).toBeInstanceOf(TransportBase);
    });

    it('starts disconnected', () => {
        const ep = hub.createEndpoint('test');
        expect(ep.state).toBe(TransportState.DISCONNECTED);
        expect(ep.isConnected).toBe(false);
    });

    it('connects and disconnects', () => {
        const ep = hub.createEndpoint('test');

        ep.connect();
        expect(ep.state).toBe(TransportState.CONNECTED);
        expect(ep.isConnected).toBe(true);

        ep.disconnect();
        expect(ep.state).toBe(TransportState.DISCONNECTED);
        expect(ep.isConnected).toBe(false);
    });

    it('connect is idempotent', () => {
        const ep = hub.createEndpoint('test');
        ep.connect();
        ep.connect(); // Should not throw
        expect(ep.state).toBe(TransportState.CONNECTED);
    });

    it('reports type as memory', () => {
        const ep = hub.createEndpoint('test');
        expect(ep.type).toBe('memory');
    });
});

// ========================================
// Channel API: joinChannel + broadcastToChannel
// ========================================

describe('Channel API: joinChannel + broadcastToChannel', () => {
    let hub, host, guest;

    beforeEach(() => {
        hub = new MemoryTransportHub();
        host = hub.createEndpoint('host');
        guest = hub.createEndpoint('guest');
    });

    it('delivers messages to subscribers on the same channel', async () => {
        const received = [];

        await host.joinChannel('lobby', (msg) => received.push({ endpoint: 'host', msg }));
        await guest.joinChannel('lobby', (msg) => received.push({ endpoint: 'guest', msg }));

        await host.broadcastToChannel('lobby', { type: 'HOST_ANNOUNCE', name: 'Test' });

        // Guest should receive, host should NOT (sender excluded)
        expect(received.length).toBe(1);
        expect(received[0].endpoint).toBe('guest');
        expect(received[0].msg.type).toBe('HOST_ANNOUNCE');
        expect(received[0].msg.name).toBe('Test');
    });

    it('sender does NOT receive own broadcast', async () => {
        const hostReceived = [];
        const guestReceived = [];

        await host.joinChannel('lobby', (msg) => hostReceived.push(msg));
        await guest.joinChannel('lobby', (msg) => guestReceived.push(msg));

        await host.broadcastToChannel('lobby', { type: 'PING' });

        expect(hostReceived.length).toBe(0);
        expect(guestReceived.length).toBe(1);
    });

    it('delivers to multiple subscribers (3-way)', async () => {
        const guest2 = hub.createEndpoint('guest2');
        const hostMsgs = [];
        const guest1Msgs = [];
        const guest2Msgs = [];

        await host.joinChannel('session', (msg) => hostMsgs.push(msg));
        await guest.joinChannel('session', (msg) => guest1Msgs.push(msg));
        await guest2.joinChannel('session', (msg) => guest2Msgs.push(msg));

        await host.broadcastToChannel('session', { type: 'STATE_SYNC' });

        expect(hostMsgs.length).toBe(0);   // Sender excluded
        expect(guest1Msgs.length).toBe(1);
        expect(guest2Msgs.length).toBe(1);
    });

    it('throws when broadcasting to un-joined channel', async () => {
        await expect(
            host.broadcastToChannel('unknown', { type: 'TEST' })
        ).rejects.toThrow('Not joined to channel: unknown');
    });

    it('joinChannel requires a channel name', async () => {
        await expect(host.joinChannel('', () => {})).rejects.toThrow('Channel name is required');
    });

    it('broadcastToChannel requires a channel name', async () => {
        await expect(host.broadcastToChannel('', {})).rejects.toThrow('Channel name is required');
    });

    it('joinChannel is idempotent', async () => {
        let callCount = 0;
        await host.joinChannel('lobby', () => callCount++);
        await host.joinChannel('lobby', () => callCount++); // Should not double-subscribe

        await guest.joinChannel('lobby', () => {});
        await guest.broadcastToChannel('lobby', { type: 'TEST' });

        // Should only receive once (first callback is kept)
        expect(callCount).toBe(1);
    });
});

// ========================================
// Multiple Channels (lobby + session)
// ========================================

describe('Multiple channels', () => {
    let hub, host, guest;

    beforeEach(() => {
        hub = new MemoryTransportHub();
        host = hub.createEndpoint('host');
        guest = hub.createEndpoint('guest');
    });

    it('messages on one channel do not leak to another', async () => {
        const lobbyMsgs = [];
        const sessionMsgs = [];

        await host.joinChannel('lobby', () => {});
        await guest.joinChannel('lobby', (msg) => lobbyMsgs.push(msg));

        await host.joinChannel('session:abc', () => {});
        await guest.joinChannel('session:abc', (msg) => sessionMsgs.push(msg));

        await host.broadcastToChannel('lobby', { type: 'HOST_ANNOUNCE' });
        await host.broadcastToChannel('session:abc', { type: 'CMD_BATCH' });

        expect(lobbyMsgs.length).toBe(1);
        expect(lobbyMsgs[0].type).toBe('HOST_ANNOUNCE');

        expect(sessionMsgs.length).toBe(1);
        expect(sessionMsgs[0].type).toBe('CMD_BATCH');
    });

    it('endpoint can be on lobby but not session', async () => {
        await host.joinChannel('lobby', () => {});
        await guest.joinChannel('lobby', () => {});
        // Guest does NOT join session

        await host.joinChannel('session:abc', () => {});

        // Broadcasting on session should not reach guest
        const guestMsgs = [];
        // Guest is only on lobby, so we test by checking no error
        // and no messages arrive on guest's lobby callback for session messages
        await host.broadcastToChannel('session:abc', { type: 'CMD_BATCH' });

        // Verify guest is not on session channel
        expect(guest.isJoinedToChannel('session:abc')).toBe(false);
        expect(guest.isJoinedToChannel('lobby')).toBe(true);
    });

    it('leaveChannel stops message delivery', async () => {
        const received = [];

        await host.joinChannel('lobby', () => {});
        await guest.joinChannel('lobby', (msg) => received.push(msg));

        await host.broadcastToChannel('lobby', { type: 'MSG1' });
        expect(received.length).toBe(1);

        await guest.leaveChannel('lobby');

        await host.broadcastToChannel('lobby', { type: 'MSG2' });
        expect(received.length).toBe(1); // No new message
    });
});

// ========================================
// Global onMessage handler
// ========================================

describe('onMessage (global handler)', () => {
    let hub, host, guest;

    beforeEach(() => {
        hub = new MemoryTransportHub();
        host = hub.createEndpoint('host');
        guest = hub.createEndpoint('guest');
    });

    it('onMessage receives messages from all joined channels', async () => {
        const globalMsgs = [];

        guest.onMessage((msg) => globalMsgs.push(msg));

        await host.joinChannel('lobby', () => {});
        await guest.joinChannel('lobby', () => {});

        await host.joinChannel('session', () => {});
        await guest.joinChannel('session', () => {});

        await host.broadcastToChannel('lobby', { type: 'ANNOUNCE' });
        await host.broadcastToChannel('session', { type: 'CMD_BATCH' });

        expect(globalMsgs.length).toBe(2);
        expect(globalMsgs[0].type).toBe('ANNOUNCE');
        expect(globalMsgs[1].type).toBe('CMD_BATCH');
    });

    it('onMessage set before joinChannel still receives', async () => {
        const globalMsgs = [];

        // Set handler BEFORE joining channels (like SessionManager.setTransport)
        guest.onMessage((msg) => globalMsgs.push(msg));

        await host.joinChannel('lobby', () => {});
        await guest.joinChannel('lobby', () => {});

        await host.broadcastToChannel('lobby', { type: 'TEST' });

        expect(globalMsgs.length).toBe(1);
    });

    it('channel callback and onMessage both fire', async () => {
        const channelMsgs = [];
        const globalMsgs = [];

        guest.onMessage((msg) => globalMsgs.push(msg));
        await guest.joinChannel('lobby', (msg) => channelMsgs.push(msg));

        await host.joinChannel('lobby', () => {});
        await host.broadcastToChannel('lobby', { type: 'DUAL' });

        expect(channelMsgs.length).toBe(1);
        expect(globalMsgs.length).toBe(1);
        expect(channelMsgs[0].type).toBe('DUAL');
        expect(globalMsgs[0].type).toBe('DUAL');
    });
});

// ========================================
// Base Transport API (send/connect/disconnect)
// ========================================

describe('Base transport API (send)', () => {
    let hub, ep1, ep2;

    beforeEach(() => {
        hub = new MemoryTransportHub();
        ep1 = hub.createEndpoint('ep1');
        ep2 = hub.createEndpoint('ep2');
    });

    it('send delivers commands to other connected endpoints', () => {
        const received = [];
        ep2.onReceive = (cmd) => received.push(cmd);

        ep1.connect();
        ep2.connect();

        ep1.send({ type: 'MOVE', unitId: 1 });

        expect(received.length).toBe(1);
        expect(received[0].type).toBe('MOVE');
        expect(received[0].unitId).toBe(1);
    });

    it('send does not deliver when disconnected', () => {
        const received = [];
        ep2.onReceive = (cmd) => received.push(cmd);

        // ep1 NOT connected
        ep2.connect();

        ep1.send({ type: 'MOVE', unitId: 1 });

        expect(received.length).toBe(0);
    });

    it('send tracks statistics', () => {
        ep1.connect();
        ep2.connect();
        ep2.onReceive = () => {};

        ep1.send({ type: 'A' });
        ep1.send({ type: 'B' });
        ep1.send({ type: 'C' });

        const stats = ep1.getStats();
        expect(stats.sent).toBe(3);
        expect(stats.state).toBe(TransportState.CONNECTED);
    });

    it('disconnect cleans up all channels', async () => {
        ep1.connect();

        await ep1.joinChannel('lobby', () => {});
        await ep1.joinChannel('session', () => {});

        expect(ep1.joinedChannels.length).toBeGreaterThan(0);

        ep1.disconnect();

        expect(ep1.joinedChannels.length).toBe(0);
        expect(ep1.isConnected).toBe(false);
    });
});

// ========================================
// Message Ordering (FIFO)
// ========================================

describe('Message ordering (FIFO)', () => {
    let hub, host, guest;

    beforeEach(() => {
        hub = new MemoryTransportHub();
        host = hub.createEndpoint('host');
        guest = hub.createEndpoint('guest');
    });

    it('messages arrive in send order', async () => {
        const received = [];

        await host.joinChannel('session', () => {});
        await guest.joinChannel('session', (msg) => received.push(msg));

        // Send multiple messages rapidly
        await host.broadcastToChannel('session', { type: 'CMD1', seq: 1 });
        await host.broadcastToChannel('session', { type: 'CMD2', seq: 2 });
        await host.broadcastToChannel('session', { type: 'CMD3', seq: 3 });
        await host.broadcastToChannel('session', { type: 'CMD4', seq: 4 });
        await host.broadcastToChannel('session', { type: 'CMD5', seq: 5 });

        expect(received.length).toBe(5);
        for (let i = 0; i < 5; i++) {
            expect(received[i].seq).toBe(i + 1);
        }
    });

    it('interleaved senders maintain per-sender FIFO', async () => {
        const received = [];

        await host.joinChannel('session', () => {});
        await guest.joinChannel('session', () => {});

        // Third endpoint observes all
        const observer = hub.createEndpoint('observer');
        await observer.joinChannel('session', (msg) => received.push(msg));

        // Interleave host and guest messages
        await host.broadcastToChannel('session', { from: 'host', seq: 1 });
        await guest.broadcastToChannel('session', { from: 'guest', seq: 1 });
        await host.broadcastToChannel('session', { from: 'host', seq: 2 });
        await guest.broadcastToChannel('session', { from: 'guest', seq: 2 });

        // Observer should see all 4 in order
        expect(received.length).toBe(4);
        expect(received[0]).toEqual({ from: 'host', seq: 1 });
        expect(received[1]).toEqual({ from: 'guest', seq: 1 });
        expect(received[2]).toEqual({ from: 'host', seq: 2 });
        expect(received[3]).toEqual({ from: 'guest', seq: 2 });
    });
});

// ========================================
// TransportBase default methods (throw not-implemented)
// ========================================

describe('TransportBase channel method defaults', () => {
    it('joinChannel throws not-implemented', async () => {
        const base = new TransportBase();
        await expect(base.joinChannel('test', () => {})).rejects.toThrow(
            'TransportBase.joinChannel() must be implemented by subclass'
        );
    });

    it('broadcastToChannel throws not-implemented', async () => {
        const base = new TransportBase();
        await expect(base.broadcastToChannel('test', {})).rejects.toThrow(
            'TransportBase.broadcastToChannel() must be implemented by subclass'
        );
    });

    it('onMessage throws not-implemented', () => {
        const base = new TransportBase();
        expect(() => base.onMessage(() => {})).toThrow(
            'TransportBase.onMessage() must be implemented by subclass'
        );
    });
});

// ========================================
// Latency simulation
// ========================================

describe('Latency simulation', () => {
    it('delivers messages after specified delay', async () => {
        const hub = new MemoryTransportHub({ latencyMs: 50 });
        const host = hub.createEndpoint('host');
        const guest = hub.createEndpoint('guest');

        const received = [];

        await host.joinChannel('lobby', () => {});
        await guest.joinChannel('lobby', (msg) => received.push(msg));

        await host.broadcastToChannel('lobby', { type: 'DELAYED' });

        // Synchronously, nothing should be received yet
        expect(received.length).toBe(0);

        // Wait for the latency
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(received.length).toBe(1);
        expect(received[0].type).toBe('DELAYED');
    });
});
