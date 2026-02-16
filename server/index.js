/**
 * Asterobia Server - Entry Point
 *
 * Combined HTTP static file server + WebSocket relay on a SINGLE port.
 * Default port: 8081 (same as the old http-server, so bookmarks work).
 *
 * Phase 1 (default): Static files + WS Channel Relay.
 * Phase 2A (PHASE2A=1): Static files + Relay + Authoritative GameServer.
 *
 * Usage:
 *   node server/index.js                          # Phase 1 on :8081
 *   set PHASE2A=1 && node server/index.js         # Phase 2A on :8081
 *   set PORT=9000 && node server/index.js         # Custom port
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WsRelay } from './WsRelay.js';
import { GameServer } from './GameServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = parseInt(process.env.PORT || '8081', 10);
const PHASE2A = process.env.PHASE2A === '1';
const ENABLE_PHYSICS = process.env.ENABLE_PHYSICS === '1';

// ── Minimal static file server ─────────────────────────────────
const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.mjs':  'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.glb':  'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.woff2':'font/woff2',
    '.mp3':  'audio/mpeg',
    '.ogg':  'audio/ogg',
    '.wav':  'audio/wav',
    '.wasm': 'application/wasm',
};

function serveStatic(req, res) {
    const urlPath = (req.url || '/').split('?')[0];
    let filePath = path.join(ROOT, urlPath === '/' ? '/game.html' : urlPath);

    // Security: prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(resolved, (statErr, stats) => {
        if (statErr || !stats.isFile()) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        const ext = path.extname(resolved).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        fs.createReadStream(resolved).pipe(res);
    });
}

// ── HTTP server + WS relay on one port ─────────────────────────
const httpServer = http.createServer(serveStatic);

// Register error handler BEFORE listen() and startOnServer() —
// EADDRINUSE fires synchronously on listen(); ws re-emits it on its
// WebSocketServer. If we register after, it becomes an unhandled error.
httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n[ERROR] Port ${PORT} is already in use.`);
        console.error('  Another server or previous instance may still be running.');
        console.error('  Fix: Close the other process, or use a different port:');
        console.error(`    set PORT=3001 && node server/index.js          (Windows)`);
        console.error(`    PORT=3001 node server/index.js                 (Linux/Mac)\n`);
        process.exit(1);
    }
    throw err;
});

const relay = new WsRelay();
relay.startOnServer(httpServer);

httpServer.listen(PORT, () => {
    const mode = PHASE2A ? 'Phase 2A - Server Authority' : 'Phase 1 - WS Relay';
    console.log(`[Asterobia Server] ${mode}`);
    console.log(`[Asterobia Server] http + ws on http://localhost:${PORT}`);
    console.log('[Asterobia Server] Press Ctrl+C to stop');
});

// ── Phase 2A: wire authoritative GameServer ────────────────────
if (PHASE2A) {
    const gameServer = new GameServer({
        tickRate: 20,
        enablePhysics: ENABLE_PHYSICS,
        physicsOptions: ENABLE_PHYSICS ? {} : {}  // gravity defaults to 9.81 in PhysicsWorld
    });
    gameServer.wireToRelay(relay);
    gameServer.start();
    if (ENABLE_PHYSICS) {
        console.log('[Asterobia Server] Physics ENABLED (Rapier)');
    }
}

// ── Graceful shutdown ──────────────────────────────────────────
function shutdown(signal) {
    console.log(`\n[Asterobia Server] Shutting down (${signal})...`);
    relay.stop().then(() => {
        httpServer.close(() => process.exit(0));
    });
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
