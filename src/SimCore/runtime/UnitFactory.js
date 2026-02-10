/**
 * UnitFactory.js
 * @environment isomorphic
 *
 * Factory for spawning Units from TypeBlueprints.
 * Part of the Production Stub (Prompt 06).
 *
 * PURITY AUDIT (2026-02-10):
 *   - THREE and Entities/Unit are lazy-loaded only on the client (typeof window).
 *   - Server / headless callers get UnitModel-only units via _headlessUnit().
 *   - No top-level browser imports remain; safe for Node.js `import`.
 */

// --- Lazy client-only deps (never evaluated on server) ---
let THREE = null;
let _Unit = null;

/**
 * Ensure THREE + Unit are loaded (client-only, idempotent).
 * Called internally by functions that need rendering objects.
 * On server / headless this is never invoked because guard checks
 * prevent reaching rendering paths.
 * @returns {boolean} true if client deps are available
 */
async function _ensureClientDeps() {
    if (THREE && _Unit) return true;
    try {
        THREE = await import('three');
        const mod = await import('../../Entities/Unit.js');
        _Unit = mod.Unit;
        return true;
    } catch {
        return false;
    }
}

/**
 * Synchronous check whether client deps were loaded.
 * @returns {boolean}
 */
function _hasClientDeps() {
    return THREE !== null && _Unit !== null;
}

import { getBlueprint } from './BlueprintStorage.js';
import { bindUnitToBlueprint } from './UnitTypeBinder.js';
import { nextEntityId } from './IdGenerator.js';
import { rngNext } from './SeededRNG.js';
import { UnitModel } from '../domain/UnitModel.js';

/**
 * Get a spawn position near a reference point on spherical terrain.
 * Returns a plain {x, y, z} object in headless mode, or a THREE.Vector3 when
 * client deps are available.
 *
 * @param {Game} game - The game instance
 * @param {Object} options - Spawn options
 * @param {Object} [options.position] - Explicit position (Vector3 or {x,y,z})
 * @param {Object} [options.nearUnit] - Spawn near this unit
 * @param {number} [options.offset] - Distance offset from reference (default 5)
 * @returns {Object} The spawn position (Vector3 or plain {x,y,z})
 */
export function getSpawnPosition(game, options = {}) {
    const offset = options.offset || 5; // Smaller default offset

    // --- Headless / server path: return plain {x,y,z} ---
    if (!_hasClientDeps()) {
        if (options.position) {
            const p = options.position;
            return { x: p.x, y: p.y, z: p.z };
        }
        const terrainRadius = game.planet?.terrain?.params?.radius || 10;
        // Seeded random point on sphere
        const angle = rngNext() * Math.PI * 2;
        const phi = Math.acos(2 * rngNext() - 1);
        return {
            x: terrainRadius * Math.sin(phi) * Math.cos(angle),
            y: terrainRadius * Math.sin(phi) * Math.sin(angle),
            z: terrainRadius * Math.cos(phi)
        };
    }

    // --- Client path (THREE available) ---

    // Explicit position
    if (options.position) {
        return options.position.clone ? options.position.clone() : new THREE.Vector3(options.position.x, options.position.y, options.position.z);
    }

    // Get reference position (nearUnit, selectedUnit, main unit, or camera target)
    let refPos = null;

    if (options.nearUnit && options.nearUnit.position) {
        refPos = options.nearUnit.position.clone();
    } else if (game.selectedUnit && game.selectedUnit.position) {
        refPos = game.selectedUnit.position.clone();
    } else if (game.units && game.units.length > 0 && game.units[0].position) {
        refPos = game.units[0].position.clone();
    } else if (game.camera) {
        // Camera look-at point on planet surface
        const cameraDir = new THREE.Vector3();
        game.camera.getWorldDirection(cameraDir);
        const terrainRadius = game.planet?.terrain?.params?.radius || 10;
        refPos = cameraDir.multiplyScalar(terrainRadius);
    }

    if (!refPos) {
        // Last resort: north pole
        const terrainRadius = game.planet?.terrain?.params?.radius || 10;
        return new THREE.Vector3(0, terrainRadius, 0);
    }

    // Get terrain radius
    const terrainRadius = game.planet?.terrain?.params?.radius || refPos.length();

    // Create tangent plane basis at reference position
    const radialDir = refPos.clone().normalize();

    // Create tangent vectors (perpendicular to radial)
    let tangent1 = new THREE.Vector3(1, 0, 0);
    if (Math.abs(radialDir.dot(tangent1)) > 0.9) {
        tangent1.set(0, 1, 0);
    }
    tangent1.crossVectors(radialDir, tangent1).normalize();
    const tangent2 = new THREE.Vector3().crossVectors(radialDir, tangent1).normalize();

    // Random angle on tangent plane (R004: seeded RNG for determinism)
    const angle = rngNext() * Math.PI * 2;
    const offsetVec = tangent1.clone().multiplyScalar(Math.cos(angle) * offset)
        .add(tangent2.clone().multiplyScalar(Math.sin(angle) * offset));

    // Add offset to reference position
    const spawnPos = refPos.clone().add(offsetVec);

    // Project back to terrain surface (normalize then scale to terrain radius)
    const spawnDir = spawnPos.clone().normalize();

    // Get actual terrain height at this direction
    let actualRadius = terrainRadius;
    if (game.planet?.terrain?.getRadiusAt) {
        actualRadius = game.planet.terrain.getRadiusAt(spawnDir);
    }

    return spawnDir.multiplyScalar(actualRadius);
}

/**
 * Spawn a new Unit from a TypeBlueprint.
 *
 * On the CLIENT (THREE available): creates a full Unit with mesh + model.
 * On the SERVER / headless: creates a UnitModel-only object (no mesh, no scene).
 *
 * @param {Game} game - The game instance
 * @param {string} blueprintId - The blueprint to spawn from
 * @param {Object} [options] - Spawn options
 * @param {string} [options.ownerId] - Owner ID (defaults to 'local')
 * @param {Object} [options.position] - Explicit spawn position
 * @param {Object} [options.nearUnit] - Spawn near this unit
 * @returns {Object|null} The spawned unit (Unit or headless UnitModel wrapper), or null if failed
 */
export function spawnUnit(game, blueprintId, options = {}) {
    const blueprint = getBlueprint(blueprintId);
    if (!blueprint) {
        console.warn(`[UnitFactory] Blueprint not found: ${blueprintId}`);
        return null;
    }

    if (!game.planet) {
        console.warn('[UnitFactory] Game planet not available');
        return null;
    }

    // Create unit (R003: deterministic ID)
    const unitId = nextEntityId();

    // --- Headless / server path ---
    if (!_hasClientDeps()) {
        return _spawnHeadlessUnit(game, blueprint, blueprintId, unitId, options);
    }

    // --- Client path (THREE + Unit available) ---
    const unit = new _Unit(game.planet, unitId);

    // Get spawn position on spherical terrain
    const spawnPos = getSpawnPosition(game, options);

    // Set the unit's position (THREE.Vector3)
    unit.position.copy(spawnPos);

    // CRITICAL: Snap to terrain surface AFTER setting position
    // This projects the position onto the actual terrain height
    unit.snapToSurface();

    // Update mesh position from unit position
    if (unit.mesh) {
        unit.mesh.position.copy(unit.position);
        unit.mesh.quaternion.copy(unit.quaternion);
    }

    // Sync model position
    if (unit.model) {
        unit.model.position = { x: unit.position.x, y: unit.position.y, z: unit.position.z };
    }

    // Bind to blueprint (applies stats to model)
    bindUnitToBlueprint(unit.model, blueprintId);

    // Sync Unit's speed from model
    unit.speed = unit.model.speed;

    // Set unit name from blueprint name
    unit.name = blueprint.name;
    if (unit.model) {
        unit.model.name = blueprint.name;
    }

    // Set owner
    const ownerId = options.ownerId || 'local';
    if (unit.model) {
        unit.model.ownerId = ownerId;
    }

    // Add to scene
    if (game.scene && unit.mesh) {
        game.scene.add(unit.mesh);
    }

    // Add to game's unit list
    if (game.units) {
        game.units.push(unit);
    }

    console.log(`[UnitFactory] Spawned "${unit.name}" speed=${unit.speed.toFixed(1)} at (${unit.position.x.toFixed(1)}, ${unit.position.y.toFixed(1)}, ${unit.position.z.toFixed(1)})`);

    return unit;
}

/**
 * Spawn a headless unit (server/Node.js) using only UnitModel.
 * No THREE.js, no mesh, no scene — pure data.
 * @private
 */
function _spawnHeadlessUnit(game, blueprint, blueprintId, unitId, options) {
    const model = new UnitModel({ id: `unit-${unitId}`, name: blueprint.name });

    // Position
    const pos = getSpawnPosition(game, options);
    model.position = { x: pos.x, y: pos.y, z: pos.z };

    // Bind blueprint stats
    bindUnitToBlueprint(model, blueprintId);

    // Owner
    model.ownerId = options.ownerId || 'local';

    // Wrap in a thin object that looks enough like a Unit for callers
    const headlessUnit = {
        id: unitId,
        name: blueprint.name,
        model,
        position: model.position,
        speed: model.speed,
        mesh: null,
        // Add to game unit list
    };

    if (game.units) {
        game.units.push(headlessUnit);
    }

    console.log(`[UnitFactory] Spawned headless "${headlessUnit.name}" speed=${model.speed}`);
    return headlessUnit;
}

/**
 * Apply a blueprint to an existing Unit.
 *
 * @param {Object} unit - The unit to modify (Unit or headless wrapper)
 * @param {string} blueprintId - The blueprint to apply
 * @returns {boolean} True if successful
 */
export function applyBlueprintToUnit(unit, blueprintId) {
    if (!unit || !unit.model) {
        console.warn('[UnitFactory] Invalid unit');
        return false;
    }

    const binding = bindUnitToBlueprint(unit.model, blueprintId);
    if (!binding) {
        return false;
    }

    // Sync Unit's speed from model
    unit.speed = unit.model.speed;

    console.log(`[UnitFactory] Applied blueprint to existing unit, new speed: ${unit.speed}`);

    return true;
}

/**
 * Pre-load client dependencies (call early in browser entry point).
 * No-op on server. Returns true if client deps became available.
 * @returns {Promise<boolean>}
 */
export async function initClientFactory() {
    return _ensureClientDeps();
}
