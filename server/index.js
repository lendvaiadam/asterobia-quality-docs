/**
 * Asterobia Server - Entry Point (Phase 0 scaffold)
 *
 * Verifies that SimCore modules can be imported cleanly from the server
 * context (Node.js, no browser globals, no Three.js).
 *
 * Usage:
 *   cd server && node index.js
 */

import { GameServer } from './GameServer.js';
import { SimLoop } from '../src/SimCore/runtime/SimLoop.js';
import { CommandQueue, CommandType } from '../src/SimCore/runtime/CommandQueue.js';
import { HeadlessUnit } from './HeadlessUnit.js';

console.log('[Asterobia Server] Phase 0 scaffold');
console.log('[Asterobia Server] SimLoop imported:', typeof SimLoop === 'function' ? 'OK' : 'FAIL');
console.log('[Asterobia Server] CommandQueue imported:', typeof CommandQueue === 'function' ? 'OK' : 'FAIL');
console.log('[Asterobia Server] CommandType keys:', Object.keys(CommandType).join(', '));

const server = new GameServer({ tickRate: 20 });
const room = server.createRoom('test-room');
console.log('[Asterobia Server] Room created:', room.roomId, '| state:', room.state);

// Verify HeadlessUnit works
const unit = new HeadlessUnit(1, 0);
unit.position.x = 10;
unit.position.z = 20;
room.units.push(unit);

const snapshot = room.getSnapshot();
console.log('[Asterobia Server] Snapshot tick:', snapshot.tick, '| units:', snapshot.units.length);
console.log('[Asterobia Server] Unit snapshot:', JSON.stringify(snapshot.units[0]));

console.log('[Asterobia Server] Ready. (No WebSocket yet - Phase 0)');
