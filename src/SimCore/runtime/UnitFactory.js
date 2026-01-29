/**
 * UnitFactory.js
 * 
 * Factory for spawning Units from TypeBlueprints.
 * Part of the Production Stub (Prompt 06).
 */

import * as THREE from 'three';
import { Unit } from '../../Entities/Unit.js';
import { getBlueprint } from './BlueprintStorage.js';
import { bindUnitToBlueprint } from './UnitTypeBinder.js';
import { nextEntityId } from './IdGenerator.js';

/**
 * Get a spawn position near a reference point on spherical terrain.
 * 
 * @param {Game} game - The game instance
 * @param {Object} options - Spawn options
 * @param {THREE.Vector3} [options.position] - Explicit position
 * @param {Unit} [options.nearUnit] - Spawn near this unit
 * @param {number} [options.offset] - Distance offset from reference (default 5)
 * @returns {THREE.Vector3} The spawn position
 */
export function getSpawnPosition(game, options = {}) {
    const offset = options.offset || 5; // Smaller default offset

    // Explicit position
    if (options.position) {
        return options.position.clone();
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
    
    // Random angle on tangent plane
    const angle = Math.random() * Math.PI * 2;
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
 * @param {Game} game - The game instance
 * @param {string} blueprintId - The blueprint to spawn from
 * @param {Object} [options] - Spawn options
 * @param {string} [options.ownerId] - Owner ID (defaults to 'local')
 * @param {THREE.Vector3} [options.position] - Explicit spawn position
 * @param {Unit} [options.nearUnit] - Spawn near this unit
 * @returns {Unit|null} The spawned unit, or null if failed
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
    const unit = new Unit(game.planet, unitId);

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
 * Apply a blueprint to an existing Unit.
 * 
 * @param {Unit} unit - The unit to modify
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
