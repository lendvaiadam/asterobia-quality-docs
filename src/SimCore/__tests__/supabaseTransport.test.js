/**
 * Supabase Transport & Storage Tests (R012)
 *
 * Tests SupabaseTransport and SupabaseStorageAdapter with mocked Supabase client.
 * Verifies determinism invariants and no-bypass guarantees.
 *
 * Run: npx vitest run src/SimCore/__tests__/supabaseTransport.test.js
 */

import { describe, it, expect } from 'vitest';
import { SupabaseTransport } from '../transport/SupabaseTransport.js';
import { SupabaseStorageAdapter } from '../persistence/SupabaseStorageAdapter.js';
import { TransportState } from '../transport/ITransport.js';
import { CommandQueue, CommandType } from '../runtime/CommandQueue.js';

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

// ============ Tests ============

describe('Supabase Transport & Storage (R012)', () => {

    describe('SupabaseTransport', () => {

        it('SupabaseTransport requires supabaseClient', () => {
            expect(() => new SupabaseTransport({})).toThrow('supabaseClient');
        });

        it('SupabaseTransport starts disconnected', () => {
            const supabase = createMockSupabase();
            const transport = new SupabaseTransport({ supabaseClient: supabase });

            expect(transport.state).toBe(TransportState.DISCONNECTED);
            expect(transport.isConnected).toBe(false);
        });

        it('SupabaseTransport connects to channel', async () => {
            const supabase = createMockSupabase();
            const transport = new SupabaseTransport({ supabaseClient: supabase });

            await transport.connect();

            expect(transport.state).toBe(TransportState.CONNECTED);
            expect(transport.isConnected).toBe(true);
            expect(transport.clientId !== null).toBe(true);
        });

        it('SupabaseTransport disconnects', async () => {
            const supabase = createMockSupabase();
            const transport = new SupabaseTransport({ supabaseClient: supabase });

            await transport.connect();
            await transport.disconnect();

            expect(transport.state).toBe(TransportState.DISCONNECTED);
            expect(transport.isConnected).toBe(false);
        });

        it('SupabaseTransport queues commands before connect', async () => {
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

            expect(received.length).toBe(0);

            // Connect should flush pending
            await transport.connect();
            await transport.flush();  // Force flush

            // Wait for mock broadcast delivery
            await new Promise(r => setTimeout(r, 50));

            expect(received.length).toBe(2);
            expect(received[0].type).toBe('A');
            expect(received[1].type).toBe('B');
        });

        it('SupabaseTransport batches commands for throttling', async () => {
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
            expect(received.length).toBe(0);

            // Wait for throttle to flush
            await new Promise(r => setTimeout(r, 100));

            expect(received.length).toBe(3);
        });

        it('SupabaseTransport delivers commands from remote clients', async () => {
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

            expect(received.length).toBe(1);
            expect(received[0].type).toBe('MOVE');
            expect(received[0].unitId).toBe(1);
        });

        it('SupabaseTransport tracks statistics', async () => {
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
            expect(stats.sent).toBe(3);
            expect(stats.received).toBe(3);
            expect(stats.state).toBe(TransportState.CONNECTED);
        });

        it('NO BYPASS: SupabaseTransport delivers to CommandQueue', async () => {
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

            expect(queue.pendingCount).toBe(1);

            const commands = queue.flush(1);
            expect(commands[0].type).toBe(CommandType.SELECT);
        });

        it('NO BYPASS: Disconnected SupabaseTransport queues commands', async () => {
            const supabase = createMockSupabase();
            const queue = new CommandQueue();
            const transport = new SupabaseTransport({ supabaseClient: supabase });
            transport.onReceive = (cmd) => queue.enqueue(cmd);

            // NOT connected - send commands
            transport.send({ type: CommandType.SELECT, unitId: 1 });
            transport.send({ type: CommandType.MOVE, unitId: 1, target: { x: 0, y: 0, z: 0 } });

            // Queue should be empty (commands in transport pending)
            expect(queue.pendingCount).toBe(0);
        });

    });

    describe('SupabaseStorageAdapter', () => {

        it('SupabaseStorageAdapter requires supabaseClient', () => {
            expect(() => new SupabaseStorageAdapter(null)).toThrow('supabaseClient');
        });

        it('SupabaseStorageAdapter save requires auth', async () => {
            const supabase = createMockSupabase({ user: null });
            const adapter = new SupabaseStorageAdapter(supabase);

            const result = await adapter.save('slot1', { test: 'data' });

            expect(result.success).toBe(false);
            expect(result.error.includes('authenticated')).toBe(true);
        });

        it('SupabaseStorageAdapter save/load with auth', async () => {
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
            expect(saveResult.success).toBe(true);

            // Load
            const loadResult = await adapter.load('slot1');
            expect(loadResult.success).toBe(true);
            expect(loadResult.data.state.simLoop.tickCount).toBe(100);
        });

        it('SupabaseStorageAdapter load returns error for missing save', async () => {
            const supabase = createMockSupabase({ user: { id: 'user-456' } });
            const adapter = new SupabaseStorageAdapter(supabase);

            const result = await adapter.load('nonexistent');

            expect(result.success).toBe(false);
            expect(result.error.includes('not found')).toBe(true);
        });

        it('SupabaseStorageAdapter anonymous sign-in', async () => {
            const supabase = createMockSupabase({ user: null });
            const adapter = new SupabaseStorageAdapter(supabase);

            const result = await adapter.signInAnonymously();

            expect(result.success).toBe(true);
            expect(result.userId !== null).toBe(true);
        });

    });

    it('INTEGRATION: Full command flow with Supabase transport', async () => {
        const supabase = createMockSupabase({ user: { id: 'test-user' } });
        const queue = new CommandQueue();
        const transport = new SupabaseTransport({
            supabaseClient: supabase,
            throttleMs: 1
        });
        const storage = new SupabaseStorageAdapter(supabase);

        // Wire transport -> queue
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
        expect(tickCount).toBe(1);

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
        expect(saveResult.success).toBe(true);

        // Load state
        const loadResult = await storage.load('test-slot');
        expect(loadResult.success).toBe(true);
        expect(loadResult.data.state.simLoop.tickCount).toBe(1);
        expect(loadResult.data.state.game.units[0].position.x).toBe(10);
    });

});
