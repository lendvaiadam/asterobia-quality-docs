/**
 * Asterobia Server - Entry Point (Phase 1: WS Channel Relay)
 *
 * Starts a WebSocket relay server that acts as a dumb channel-based
 * message broker (drop-in replacement for Supabase Realtime).
 *
 * Clients connect and subscribe to named channels, then broadcast
 * JSON payloads to other subscribers on the same channel.
 *
 * Usage:
 *   cd server && node index.js
 *   PORT=8080 node index.js
 */

import { WsRelay } from './WsRelay.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const relay = new WsRelay({ port: PORT });

relay.start();

console.log('[Asterobia Server] Phase 1 - WS Channel Relay');
console.log(`[Asterobia Server] Listening on ws://localhost:${PORT}`);
console.log('[Asterobia Server] Press Ctrl+C to stop');

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Asterobia Server] Shutting down...');
    relay.stop().then(() => {
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n[Asterobia Server] Shutting down (SIGTERM)...');
    relay.stop().then(() => {
        process.exit(0);
    });
});
