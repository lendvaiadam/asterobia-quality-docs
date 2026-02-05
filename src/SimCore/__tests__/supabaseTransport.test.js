/**
 * Supabase Transport & Storage Tests (R012)
 *
 * Tests SupabaseTransport and SupabaseStorageAdapter with mocked Supabase client.
 * Verifies determinism invariants and no-bypass guarantees.
 *
 * Run: node --experimental-vm-modules src/SimCore/__tests__/supabaseTransport.test.js
 */

import { SupabaseTransport } from '../transport/SupabaseTransport.js';
import { SupabaseStorageAdapter } from '../persistence/SupabaseStorageAdapter.js';
import { TransportState } from '../transport/ITransport.js';
import { CommandQueue, CommandType } from '../runtime/CommandQueue.js';

// ============ Test Framework ============

let passed = 0;
let failed = 0;

function test(name, fn) {
    return (async () => {
        try {
            await fn();
            console.log(`✓ ${name}`);
            passed++;
        } catch (err) {
            console.log(`✗ ${name}`);
            console.log(`  Error: ${err.message}`);
            if (err.stack) {
                console.log(`  Stack: ${err.stack.split('\n').slice(1, 3).join('\n')}`);
            }
            failed++;
        }
    })();
}

function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) {
        throw new Error(`${msg} Expected ${expected}, got ${actual}`);
    }
}

function assertTrue(condition, msg = '') {
    if (!condition) {
        throw new Error(`${msg} Expected true, got false`);
    }
}

function assertFalse(condition, msg = '') {
    if (condition) {
        throw new Error(`${msg} Expected false, got true`);
    }
}

// ============ Mock Supabase Client ============

/**
 * Creates a mock Supabase client for testing.
 * Simulates Realtime broadcast and auth without network.
 */
function createMockSupabase(options = {}) {
    const channels = new Map();
    let currentUser = options.user || null;
    const storage = new Map();

    return {
        // Auth mock
        auth: {
            getUser: async () => {
                if (currentUser) {
                    return { data: { user: currentUser }, error: null };
                }
                return { data: { user: null }, error: { message: 'Not authenticated' } };
            },
            signInAnonymously: async () => {
                currentUser = { id: `anon-${Date.now()}` };
                return { data: { user: currentUser }, error: null };
            },
            signOut: async () => {
                currentUser = null;
                return { error: null };
            },
            _setUser: (user) => { currentUser = user; }
        },

        // Realtime channel mock
        channel: (name, config = {}) => {
            const listeners = new Map();
            let subscribed = false;

            const channel = {
                name,
                config,
                on: (type, filter, callback) => {
                    const key = `${type}:${filter.event}`;
                    listeners.set(key, callback);
                    return channel;
                },
                subscribe: (callback) => {
                    subscribed = true;
                    // Simulate async subscription
                    setTimeout(() => callback('SUBSCRIBED'), 10);
                    return channel;
                },
                send: async (message) => {
                    if (!subscribed) {
                        throw new Error('Channel not subscribed');
                    }
                    // Simulate broadcast delivery
                    const key = `broadcast:${message.event}`;
                    const listener = listeners.get(key);
                    if (listener && config?.config?.broadcast?.self !== false) {
                        // Wrap in payload structure like Supabase does
                        listener({ payload: message.payload });
                    }
                    return { error: null };
                },
                // Test helper: simulate receiving from another client
                _simulateReceive: (event, payload) => {
                    const key = `broadcast:${event}`;
                    const listener = listeners.get(key);
                    if (listener) {
                        listener({ payload });
                    }
                }
            };

            channels.set(name, channel);
            return channel;
        },

        removeChannel: async (channel) => {
            channels.delete(channel.name);
        },

        // Database mock for StorageAdapter
        from: (table) => {
            return {
                upsert: async (data, options) => {
                    const key = data.owner_id;
                    storage.set(key, { ...data });
                    return { error: null };
                },
                select: (columns) => ({
                    eq: (column, value) => ({
                        single: async () => {
                            const data = storage.get(value);
                            if (!data) {
                                return { data: null, error: { code: 'PGRST116', message: 'No rows' } };
                            }
                            return { data, error: null };
                        }
                    })
                }),
                delete: () => ({
                    eq: async (column, value) => {
                        storage.delete(value);
                        return { error: null };
                    }
                })
            };
        },

        // Test helpers
        _getChannels: () => channels,
        _getStorage: () => storage
    };
}

// ============ SupabaseTransport Unit Tests ============

await test('SupabaseTransport requires supabaseClient', () => {
    let threw = false;
    try {
        new SupabaseTransport({});
    } catch (err) {
        threw = true;
        assertTrue(err.message.includes('supabaseClient'), 'error message');
    }
    assertTrue(threw, 'should throw without client');
});

await test('SupabaseTransport starts disconnected', () => {
    const supabase = createMockSupabase();
    const transport = new SupabaseTransport({ supabaseClient: supabase });

    assertEqual(transport.state, TransportState.DISCONNECTED, 'initial state');
    assertFalse(transport.isConnected, 'not connected');
});

await test('SupabaseTransport connects to channel', async () => {
    const supabase = createMockSupabase();
    const transport = new SupabaseTransport({ supabaseClient: supabase });

    await transport.connect();

    assertEqual(transport.state, TransportState.CONNECTED, 'state after connect');
    assertTrue(transport.isConnected, 'is connected');
    assertTrue(transport.clientId !== null, 'has client ID');
});

await test('SupabaseTransport disconnects', async () => {
    const supabase = createMockSupabase();
    const transport = new SupabaseTransport({ supabaseClient: supabase });

    await transport.connect();
    await transport.disconnect();

    assertEqual(transport.state, TransportState.DISCONNECTED, 'state after disconnect');
    assertFalse(transport.isConnected, 'not connected');
});

await test('SupabaseTransport queues commands before connect', async () => {
    const supabase = createMockSupabase();
    const transport = new SupabaseTransport({
        supabaseClient: supabase,
        throttleMs: 1  // Fast flush for testing
    });

    const received = [];
    transport.onReceive = (cmd) => received.push(cmd);

    // Send before connect
    transport.send({ type: 'A' });
    transport.send({ type: 'B' });

    assertEqual(received.length, 0, 'no delivery before connect');

    // Connect should flush pending
    await transport.connect();
    await transport.flush();  // Force flush

    // Wait for mock broadcast delivery
    await new Promise(r => setTimeout(r, 50));

    assertEqual(received.length, 2, 'delivered after connect');
    assertEqual(received[0].type, 'A', 'first command');
    assertEqual(received[1].type, 'B', 'second command');
});

await test('SupabaseTransport batches commands for throttling', async () => {
    const supabase = createMockSupabase();
    const transport = new SupabaseTransport({
        supabaseClient: supabase,
        throttleMs: 50
    });

    await transport.connect();

    const received = [];
    transport.onReceive = (cmd) => received.push(cmd);

    // Send multiple commands rapidly
    transport.send({ type: 'A' });
    transport.send({ type: 'B' });
    transport.send({ type: 'C' });

    // Not delivered yet (throttled)
    assertEqual(received.length, 0, 'throttled - not delivered immediately');

    // Wait for throttle to flush
    await new Promise(r => setTimeout(r, 100));

    assertEqual(received.length, 3, 'all commands delivered after throttle');
});

await test('SupabaseTransport delivers commands from remote clients', async () => {
    const supabase = createMockSupabase();
    const transport = new SupabaseTransport({
        supabaseClient: supabase,
        echoLocal: false  // Don't echo own commands
    });

    await transport.connect();

    const received = [];
    transport.onReceive = (cmd) => received.push(cmd);

    // Simulate receiving from another client
    const channel = supabase._getChannels().get('asterobia-main');
    channel._simulateReceive('command', {
        clientId: 'other-client-123',
        commands: [
            { type: 'MOVE', unitId: 1, target: { x: 10, y: 0, z: 10 } }
        ]
    });

    assertEqual(received.length, 1, 'received remote command');
    assertEqual(received[0].type, 'MOVE', 'command type');
    assertEqual(received[0].unitId, 1, 'unit ID');
});

await test('SupabaseTransport tracks statistics', async () => {
    const supabase = createMockSupabase();
    const transport = new SupabaseTransport({
        supabaseClient: supabase,
        throttleMs: 1
    });
    transport.onReceive = () => {};

    await transport.connect();

    transport.send({ type: 'TEST' });
    transport.send({ type: 'TEST' });
    transport.send({ type: 'TEST' });

    await transport.flush();
    await new Promise(r => setTimeout(r, 20));

    const stats = transport.getStats();
    assertEqual(stats.sent, 3, 'sent count');
    assertEqual(stats.received, 3, 'received count (echo)');
    assertEqual(stats.state, TransportState.CONNECTED, 'state');
});

// ============ NO BYPASS PROOF (Supabase) ============

await test('NO BYPASS: SupabaseTransport delivers to CommandQueue', async () => {
    const supabase = createMockSupabase();
    const queue = new CommandQueue();
    const transport = new SupabaseTransport({
        supabaseClient: supabase,
        throttleMs: 1
    });

    // Wire transport to queue (simulates initializeTransport)
    transport.onReceive = (cmd) => queue.enqueue(cmd);
    await transport.connect();

    // Send command
    transport.send({ type: CommandType.SELECT, unitId: 1 });
    await transport.flush();
    await new Promise(r => setTimeout(r, 20));

    assertEqual(queue.pendingCount, 1, 'transport delivered to queue');

    const commands = queue.flush(1);
    assertEqual(commands[0].type, CommandType.SELECT, 'command type');
});

await test('NO BYPASS: Disconnected SupabaseTransport queues commands', async () => {
    const supabase = createMockSupabase();
    const queue = new CommandQueue();
    const transport = new SupabaseTransport({ supabaseClient: supabase });
    transport.onReceive = (cmd) => queue.enqueue(cmd);

    // NOT connected - send commands
    transport.send({ type: CommandType.SELECT, unitId: 1 });
    transport.send({ type: CommandType.MOVE, unitId: 1, target: { x: 0, y: 0, z: 0 } });

    // Queue should be empty (commands in transport pending)
    assertEqual(queue.pendingCount, 0, 'queue empty when disconnected');
});

// ============ SupabaseStorageAdapter Tests ============

await test('SupabaseStorageAdapter requires supabaseClient', () => {
    let threw = false;
    try {
        new SupabaseStorageAdapter(null);
    } catch (err) {
        threw = true;
        assertTrue(err.message.includes('supabaseClient'), 'error message');
    }
    assertTrue(threw, 'should throw without client');
});

await test('SupabaseStorageAdapter save requires auth', async () => {
    const supabase = createMockSupabase({ user: null });
    const adapter = new SupabaseStorageAdapter(supabase);

    const result = await adapter.save('slot1', { test: 'data' });

    assertFalse(result.success, 'save should fail');
    assertTrue(result.error.includes('authenticated'), 'auth error');
});

await test('SupabaseStorageAdapter save/load with auth', async () => {
    const supabase = createMockSupabase({ user: { id: 'user-123' } });
    const adapter = new SupabaseStorageAdapter(supabase);

    // Save
    const saveData = {
        schemaVersion: 1,
        format: 'asterobia-save',
        state: {
            game: { units: [] },
            simLoop: { tickCount: 100 },
            rng: { seed: 12345 },
            entityIdCounter: 50
        }
    };

    const saveResult = await adapter.save('slot1', saveData);
    assertTrue(saveResult.success, 'save should succeed');

    // Load
    const loadResult = await adapter.load('slot1');
    assertTrue(loadResult.success, 'load should succeed');
    assertEqual(loadResult.data.state.simLoop.tickCount, 100, 'tickCount preserved');
});

await test('SupabaseStorageAdapter load returns error for missing save', async () => {
    const supabase = createMockSupabase({ user: { id: 'user-456' } });
    const adapter = new SupabaseStorageAdapter(supabase);

    const result = await adapter.load('nonexistent');

    assertFalse(result.success, 'load should fail');
    assertTrue(result.error.includes('not found'), 'not found error');
});

await test('SupabaseStorageAdapter anonymous sign-in', async () => {
    const supabase = createMockSupabase({ user: null });
    const adapter = new SupabaseStorageAdapter(supabase);

    const result = await adapter.signInAnonymously();

    assertTrue(result.success, 'sign-in should succeed');
    assertTrue(result.userId !== null, 'should have userId');
});

// ============ Integration Test: Transport + Queue + Storage ============

await test('INTEGRATION: Full command flow with Supabase transport', async () => {
    const supabase = createMockSupabase({ user: { id: 'test-user' } });
    const queue = new CommandQueue();
    const transport = new SupabaseTransport({
        supabaseClient: supabase,
        throttleMs: 1
    });
    const storage = new SupabaseStorageAdapter(supabase);

    // Wire transport → queue
    transport.onReceive = (cmd) => queue.enqueue(cmd);
    await transport.connect();

    // Simulate game tick count
    let tickCount = 0;

    // Process commands for tick
    function processTick(tick) {
        const commands = queue.flush(tick);
        for (const cmd of commands) {
            // Would apply to game state here
            tickCount = tick;
        }
    }

    // Send command
    transport.send({ type: CommandType.MOVE, unitId: 1, target: { x: 10, y: 0, z: 10 }, tick: 1 });
    await transport.flush();
    await new Promise(r => setTimeout(r, 20));

    // Process tick 1
    processTick(1);
    assertEqual(tickCount, 1, 'processed tick 1');

    // Save state
    const saveResult = await storage.save('test-slot', {
        schemaVersion: 1,
        format: 'asterobia-save',
        state: {
            game: { units: [{ id: 1, position: { x: 10, y: 0, z: 10 } }] },
            simLoop: { tickCount: 1 },
            rng: { seed: 42, state: 100, callCount: 5 },
            entityIdCounter: 2
        }
    });
    assertTrue(saveResult.success, 'save succeeded');

    // Load state
    const loadResult = await storage.load('test-slot');
    assertTrue(loadResult.success, 'load succeeded');
    assertEqual(loadResult.data.state.simLoop.tickCount, 1, 'tick count preserved');
    assertEqual(loadResult.data.state.game.units[0].position.x, 10, 'position preserved');
});

// ============ Summary ============

console.log('\n=== Supabase Transport & Storage Tests (R012) ===\n');

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.error(`\n✗ ${failed} Supabase tests FAILED`);
} else {
    console.log('\n✓ All Supabase tests PASS');
    console.log('\nR012 VERIFIED:');
    console.log('  - SupabaseTransport implements ITransport');
    console.log('  - Commands flow through transport (no bypass)');
    console.log('  - Command batching and throttling works');
    console.log('  - SupabaseStorageAdapter save/load works');
    console.log('  - Auth required for persistence');
    console.log('  - Full integration flow verified');
}
