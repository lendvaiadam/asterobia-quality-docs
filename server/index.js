/**
 * Asterobia Server - Entry Point
 *
 * Phase 1 (default): WS Channel Relay only.
 * Phase 2A (PHASE2A=1): Relay + Authoritative GameServer.
 *
 * Usage:
 *   node server/index.js              # Phase 1 relay only
 *   PHASE2A=1 node server/index.js    # Phase 2A server authority
 */

import { WsRelay } from './WsRelay.js';
import { GameServer } from './GameServer.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PHASE2A = process.env.PHASE2A === '1';

const relay = new WsRelay({ port: PORT });
relay.start();

if (PHASE2A) {
    const server = new GameServer({ tickRate: 20 });
    server.wireToRelay(relay);
    server.start();
    console.log('[Asterobia Server] Phase 2A - Server Authority + WS Relay');
} else {
    console.log('[Asterobia Server] Phase 1 - WS Channel Relay');
}

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
