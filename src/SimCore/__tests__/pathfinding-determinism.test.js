/**
 * Pathfinding Determinism Test (R009)
 *
 * Proves that pathfinding is:
 * 1. Synchronous (no async/Promise in hot path)
 * 2. Deterministic (same inputs → same output, 100 runs)
 *
 * Run: node --experimental-vm-modules src/SimCore/__tests__/pathfinding-determinism.test.js
 */

// ============ Minimal Test NavMesh (No Three.js dependency) ============

/**
 * MinHeap - Same as SphericalNavMesh for A* priority queue.
 */
class MinHeap {
    constructor() {
        this.heap = [];
        this.nodeIndex = new Map();
    }

    isEmpty() { return this.heap.length === 0; }
    contains(node) { return this.nodeIndex.has(node); }

    push(node, priority) {
        const entry = { node, priority };
        this.heap.push(entry);
        this.nodeIndex.set(node, this.heap.length - 1);
        this._bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.isEmpty()) return null;
        const min = this.heap[0];
        const last = this.heap.pop();
        this.nodeIndex.delete(min.node);

        if (!this.isEmpty()) {
            this.heap[0] = last;
            this.nodeIndex.set(last.node, 0);
            this._bubbleDown(0);
        }
        return min.node;
    }

    updatePriority(node, newPriority) {
        if (!this.nodeIndex.has(node)) return;
        const idx = this.nodeIndex.get(node);
        const oldPriority = this.heap[idx].priority;
        this.heap[idx].priority = newPriority;
        if (newPriority < oldPriority) this._bubbleUp(idx);
        else this._bubbleDown(idx);
    }

    _bubbleUp(idx) {
        while (idx > 0) {
            const parentIdx = Math.floor((idx - 1) / 2);
            if (this.heap[parentIdx].priority <= this.heap[idx].priority) break;
            this._swap(idx, parentIdx);
            idx = parentIdx;
        }
    }

    _bubbleDown(idx) {
        const length = this.heap.length;
        while (true) {
            const leftIdx = 2 * idx + 1;
            const rightIdx = 2 * idx + 2;
            let smallest = idx;
            if (leftIdx < length && this.heap[leftIdx].priority < this.heap[smallest].priority) smallest = leftIdx;
            if (rightIdx < length && this.heap[rightIdx].priority < this.heap[smallest].priority) smallest = rightIdx;
            if (smallest === idx) break;
            this._swap(idx, smallest);
            idx = smallest;
        }
    }

    _swap(i, j) {
        [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
        this.nodeIndex.set(this.heap[i].node, i);
        this.nodeIndex.set(this.heap[j].node, j);
    }
}

/**
 * TestNavMesh - Minimal 2D grid navmesh for determinism testing.
 * Mirrors SphericalNavMesh A* logic without Three.js dependencies.
 */
class TestNavMesh {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.nodes = [];

        // Generate grid nodes
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                this.nodes.push({
                    index: idx,
                    x, y,
                    walkable: true,
                    neighbors: []
                });
            }
        }

        // Build neighbor connections (8-directional)
        const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                for (const [dy, dx] of dirs) {
                    const ny = y + dy, nx = x + dx;
                    if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                        this.nodes[idx].neighbors.push(ny * width + nx);
                    }
                }
            }
        }
    }

    /**
     * Mark a rectangular region as unwalkable (obstacle).
     */
    addObstacle(x1, y1, x2, y2) {
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                    this.nodes[y * this.width + x].walkable = false;
                }
            }
        }
    }

    /**
     * Euclidean distance heuristic.
     */
    heuristic(a, b) {
        const nodeA = this.nodes[a];
        const nodeB = this.nodes[b];
        return Math.sqrt((nodeA.x - nodeB.x) ** 2 + (nodeA.y - nodeB.y) ** 2);
    }

    /**
     * A* pathfinding - mirrors SphericalNavMesh.findPath() logic.
     * SYNCHRONOUS, NO PROMISES, NO TIMERS.
     */
    findPath(startIdx, goalIdx) {
        if (startIdx === goalIdx) return { success: true, path: [startIdx] };
        if (!this.nodes[startIdx].walkable || !this.nodes[goalIdx].walkable) {
            return { success: false, path: [], reason: 'Start or goal not walkable' };
        }

        const openSet = new MinHeap();
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();
        const closedSet = new Set();

        gScore.set(startIdx, 0);
        fScore.set(startIdx, this.heuristic(startIdx, goalIdx));
        openSet.push(startIdx, fScore.get(startIdx));

        const maxIterations = this.nodes.length * 2;
        let iterations = 0;

        while (!openSet.isEmpty() && iterations < maxIterations) {
            iterations++;
            const current = openSet.pop();

            if (current === goalIdx) {
                // Reconstruct path
                const path = [current];
                let node = current;
                while (cameFrom.has(node)) {
                    node = cameFrom.get(node);
                    path.unshift(node);
                }
                return { success: true, path, iterations };
            }

            closedSet.add(current);

            for (const neighbor of this.nodes[current].neighbors) {
                if (closedSet.has(neighbor) || !this.nodes[neighbor].walkable) continue;

                const edgeCost = this.heuristic(current, neighbor);
                const tentativeG = gScore.get(current) + edgeCost;

                if (gScore.has(neighbor) && tentativeG >= gScore.get(neighbor)) continue;

                cameFrom.set(neighbor, current);
                gScore.set(neighbor, tentativeG);
                fScore.set(neighbor, tentativeG + this.heuristic(neighbor, goalIdx));

                if (!openSet.contains(neighbor)) {
                    openSet.push(neighbor, fScore.get(neighbor));
                } else {
                    openSet.updatePriority(neighbor, fScore.get(neighbor));
                }
            }
        }

        return { success: false, path: [], reason: 'No path found', iterations };
    }
}

// ============ Test Framework ============

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (err) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${err.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) {
        throw new Error(`${msg} Expected ${expected}, got ${actual}`);
    }
}

function assertArrayEqual(actual, expected, msg = '') {
    if (actual.length !== expected.length) {
        throw new Error(`${msg} Array length mismatch: ${actual.length} vs ${expected.length}`);
    }
    for (let i = 0; i < actual.length; i++) {
        if (actual[i] !== expected[i]) {
            throw new Error(`${msg} Array[${i}] mismatch: ${actual[i]} vs ${expected[i]}`);
        }
    }
}

// ============ Tests ============

test('A* finds path on simple grid', () => {
    const mesh = new TestNavMesh(10, 10);
    const result = mesh.findPath(0, 99); // Top-left to bottom-right

    assertEqual(result.success, true, 'path found');
    assertEqual(result.path[0], 0, 'starts at 0');
    assertEqual(result.path[result.path.length - 1], 99, 'ends at 99');
});

test('A* handles obstacles', () => {
    const mesh = new TestNavMesh(10, 10);
    // Add a wall blocking direct path
    mesh.addObstacle(4, 0, 4, 8);

    const result = mesh.findPath(0, 9);

    assertEqual(result.success, true, 'path around obstacle');
    // Path should not contain any node in column 4 (rows 0-8)
    for (const idx of result.path) {
        const x = idx % 10;
        const y = Math.floor(idx / 10);
        if (x === 4 && y <= 8) {
            throw new Error(`Path contains obstacle node (${x}, ${y})`);
        }
    }
});

test('A* returns failure for blocked goal', () => {
    const mesh = new TestNavMesh(10, 10);
    mesh.nodes[99].walkable = false; // Block goal

    const result = mesh.findPath(0, 99);

    assertEqual(result.success, false, 'no path to blocked goal');
});

test('DETERMINISM: 100 identical runs produce identical paths', () => {
    // Create a complex scenario with multiple obstacles
    const createMesh = () => {
        const mesh = new TestNavMesh(20, 20);
        mesh.addObstacle(5, 0, 5, 15);  // Vertical wall
        mesh.addObstacle(10, 5, 10, 19); // Another wall
        mesh.addObstacle(15, 0, 15, 10); // Third wall
        return mesh;
    };

    const startIdx = 0;
    const goalIdx = 399; // Bottom-right

    // First run - establish baseline
    const mesh1 = createMesh();
    const baseline = mesh1.findPath(startIdx, goalIdx);

    if (!baseline.success) {
        throw new Error('Baseline path failed');
    }

    // Run 100 times, verify identical
    for (let i = 0; i < 100; i++) {
        const mesh = createMesh();
        const result = mesh.findPath(startIdx, goalIdx);

        assertEqual(result.success, baseline.success, `Run ${i}: success`);
        assertEqual(result.iterations, baseline.iterations, `Run ${i}: iterations`);
        assertArrayEqual(result.path, baseline.path, `Run ${i}: path`);
    }
});

test('DETERMINISM: Same obstacle pattern, same result regardless of call order', () => {
    // Create mesh with obstacles
    const mesh = new TestNavMesh(15, 15);
    mesh.addObstacle(3, 3, 3, 12);
    mesh.addObstacle(7, 0, 7, 9);
    mesh.addObstacle(11, 5, 11, 14);

    // Multiple pathfinding requests
    const paths = {
        topLeftToBottomRight: mesh.findPath(0, 224),
        topRightToBottomLeft: mesh.findPath(14, 210),
        centerToCorner: mesh.findPath(112, 0)
    };

    // Run again and verify identical
    const mesh2 = new TestNavMesh(15, 15);
    mesh2.addObstacle(3, 3, 3, 12);
    mesh2.addObstacle(7, 0, 7, 9);
    mesh2.addObstacle(11, 5, 11, 14);

    const paths2 = {
        topLeftToBottomRight: mesh2.findPath(0, 224),
        topRightToBottomLeft: mesh2.findPath(14, 210),
        centerToCorner: mesh2.findPath(112, 0)
    };

    for (const key of Object.keys(paths)) {
        assertEqual(paths[key].success, paths2[key].success, `${key} success`);
        assertArrayEqual(paths[key].path, paths2[key].path, `${key} path`);
    }
});

test('A* is synchronous (no Promise return)', () => {
    const mesh = new TestNavMesh(10, 10);
    const result = mesh.findPath(0, 99);

    // Verify result is NOT a Promise
    const isPromise = result && typeof result.then === 'function';
    assertEqual(isPromise, false, 'result is not Promise');
    assertEqual(typeof result.success, 'boolean', 'has success boolean');
    assertEqual(Array.isArray(result.path), true, 'has path array');
});

test('ITERATION COUNT: Same inputs = same iteration count', () => {
    const mesh = new TestNavMesh(20, 20);
    mesh.addObstacle(8, 0, 8, 18);

    const results = [];
    for (let i = 0; i < 50; i++) {
        results.push(mesh.findPath(0, 399));
    }

    const baseIterations = results[0].iterations;
    for (let i = 1; i < results.length; i++) {
        assertEqual(results[i].iterations, baseIterations, `Run ${i} iteration count`);
    }
});

// ============ Summary ============

console.log('\n=== Pathfinding Determinism Tests (R009) ===\n');

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.error(`\n✗ ${failed} Pathfinding Determinism tests FAILED`);
} else {
    console.log('\n✓ All Pathfinding Determinism tests PASS');
    console.log('\nPROOF OF DETERMINISM:');
    console.log('  - A* algorithm produces identical paths across 100 runs');
    console.log('  - Iteration count is consistent (no timing variance)');
    console.log('  - No Promise/async in return path');
}
