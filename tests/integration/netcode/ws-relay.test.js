import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import { WsRelay } from '../../../server/WsRelay.js';

describe('WS Relay Integration', () => {
    let httpServer;
    let relay;
    let port;

    beforeEach(async () => {
        // Create ephemeral HTTP server (port 0 = OS assigns random port)
        httpServer = http.createServer();
        relay = new WsRelay();
        relay.startOnServer(httpServer);

        await new Promise((resolve) => {
            httpServer.listen(0, () => {
                port = httpServer.address().port;
                resolve();
            });
        });
    });

    afterEach(async () => {
        await relay.stop();
        await new Promise((resolve) => httpServer.close(resolve));
    });

    // Helper: create WS client and wait for open
    function createClient() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${port}`);
            ws.on('open', () => resolve(ws));
            ws.on('error', reject);
        });
    }

    // Helper: wait for next message from ws
    function waitForMessage(ws, timeoutMs = 2000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeoutMs);
            ws.once('message', (data) => {
                clearTimeout(timer);
                resolve(JSON.parse(data.toString()));
            });
        });
    }

    it('should accept client connections', async () => {
        const ws = await createClient();
        expect(relay.clientCount).toBe(1);
        ws.close();
    });

    it('should relay broadcast between two clients', async () => {
        const clientA = await createClient();
        const clientB = await createClient();

        // Both subscribe to the same channel
        clientA.send(JSON.stringify({ type: 'subscribe', channel: 'test-room' }));
        clientB.send(JSON.stringify({ type: 'subscribe', channel: 'test-room' }));

        // Small delay to let subscriptions register
        await new Promise(r => setTimeout(r, 50));

        // A broadcasts, B should receive
        const payload = { type: 'HOST_ANNOUNCE', hostId: 'a', sessionName: 'Test' };
        clientA.send(JSON.stringify({ type: 'broadcast', channel: 'test-room', payload }));

        const msg = await waitForMessage(clientB);
        expect(msg.type).toBe('message');
        expect(msg.channel).toBe('test-room');
        expect(msg.payload.type).toBe('HOST_ANNOUNCE');
        expect(msg.payload.hostId).toBe('a');

        clientA.close();
        clientB.close();
    });

    it('should NOT echo broadcast back to sender', async () => {
        const clientA = await createClient();
        const clientB = await createClient();

        clientA.send(JSON.stringify({ type: 'subscribe', channel: 'ch1' }));
        clientB.send(JSON.stringify({ type: 'subscribe', channel: 'ch1' }));
        await new Promise(r => setTimeout(r, 50));

        // Prepare: listen for ANY message on A
        let receivedOnA = false;
        clientA.on('message', () => { receivedOnA = true; });

        // A broadcasts
        clientA.send(JSON.stringify({ type: 'broadcast', channel: 'ch1', payload: { test: true } }));

        // B should receive
        const msg = await waitForMessage(clientB);
        expect(msg.payload.test).toBe(true);

        // A should NOT have received anything
        await new Promise(r => setTimeout(r, 100));
        expect(receivedOnA).toBe(false);

        clientA.close();
        clientB.close();
    });

    it('should handle full HOST_ANNOUNCE → JOIN_REQ → JOIN_ACK flow', async () => {
        const host = await createClient();
        const guest = await createClient();

        const lobbyChannel = 'asterobia:lobby';
        const sessionChannel = 'asterobia:session:host1';

        // Host subscribes to lobby and session
        host.send(JSON.stringify({ type: 'subscribe', channel: lobbyChannel }));
        host.send(JSON.stringify({ type: 'subscribe', channel: sessionChannel }));

        // Guest subscribes to lobby and session
        guest.send(JSON.stringify({ type: 'subscribe', channel: lobbyChannel }));
        guest.send(JSON.stringify({ type: 'subscribe', channel: sessionChannel }));

        await new Promise(r => setTimeout(r, 50));

        // Step 1: Host announces
        host.send(JSON.stringify({
            type: 'broadcast',
            channel: lobbyChannel,
            payload: { type: 'HOST_ANNOUNCE', hostId: 'host1', sessionName: 'Test Room' }
        }));

        const announce = await waitForMessage(guest);
        expect(announce.payload.type).toBe('HOST_ANNOUNCE');

        // Step 2: Guest sends JOIN_REQ
        guest.send(JSON.stringify({
            type: 'broadcast',
            channel: sessionChannel,
            payload: { type: 'JOIN_REQ', guestId: 'guest1', displayName: 'Player 2' }
        }));

        const joinReq = await waitForMessage(host);
        expect(joinReq.payload.type).toBe('JOIN_REQ');

        // Step 3: Host sends JOIN_ACK
        host.send(JSON.stringify({
            type: 'broadcast',
            channel: sessionChannel,
            payload: { type: 'JOIN_ACK', accepted: true, slot: 1, guestId: 'guest1' }
        }));

        const joinAck = await waitForMessage(guest);
        expect(joinAck.payload.type).toBe('JOIN_ACK');
        expect(joinAck.payload.accepted).toBe(true);
        expect(joinAck.payload.slot).toBe(1);

        host.close();
        guest.close();
    });

    it('should handle client disconnect gracefully', async () => {
        const clientA = await createClient();
        const clientB = await createClient();

        expect(relay.clientCount).toBe(2);

        clientA.close();
        await new Promise(r => setTimeout(r, 100));

        expect(relay.clientCount).toBe(1);

        clientB.close();
    });

    it('should isolate channels', async () => {
        const clientA = await createClient();
        const clientB = await createClient();
        const clientC = await createClient();

        // A subscribes to room-1, B subscribes to room-2, C subscribes to both
        clientA.send(JSON.stringify({ type: 'subscribe', channel: 'room-1' }));
        clientB.send(JSON.stringify({ type: 'subscribe', channel: 'room-2' }));
        clientC.send(JSON.stringify({ type: 'subscribe', channel: 'room-1' }));
        clientC.send(JSON.stringify({ type: 'subscribe', channel: 'room-2' }));

        await new Promise(r => setTimeout(r, 50));

        // A broadcasts on room-1 — only C should receive (not B)
        let receivedOnB = false;
        clientB.on('message', () => { receivedOnB = true; });

        clientA.send(JSON.stringify({ type: 'broadcast', channel: 'room-1', payload: { from: 'A' } }));

        const msgC = await waitForMessage(clientC);
        expect(msgC.payload.from).toBe('A');

        await new Promise(r => setTimeout(r, 100));
        expect(receivedOnB).toBe(false);

        clientA.close();
        clientB.close();
        clientC.close();
    });
});
