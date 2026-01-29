/**
 * SimCore Runtime Module
 * 
 * Core infrastructure for the simulation engine.
 * Exports: EventBus, Store, TimeSource (classes and global singletons)
 */

export { EventBus, globalEventBus } from './EventBus.js';
export { Store, globalStore } from './Store.js';
export { TimeSource, globalTimeSource } from './TimeSource.js';
export { 
    loadStatsConfig, 
    saveStatsConfig, 
    resetStatsConfig, 
    hasCustomConfig 
} from './StatsConfigStorage.js';
export {
    getAllBlueprints,
    getBlueprintsByOwner,
    getBlueprint,
    hasBlueprint,
    saveBlueprint,
    deleteBlueprint,
    clearAllBlueprints,
    getSeedBlueprints,
    getUserBlueprints,
    getBlueprintCount,
    exportBlueprints,
    importBlueprints
} from './BlueprintStorage.js';
export {
    bindUnitToBlueprint,
    rebindUnit,
    getBinding,
    applyMoveSpeed,
    isBound,
    unbindUnit,
    getAllBindings
} from './UnitTypeBinder.js';
export {
    spawnUnit,
    getSpawnPosition,
    applyBlueprintToUnit
} from './UnitFactory.js';
export { VisionSystem } from './VisionSystem.js';
export {
    nextEntityId,
    peekEntityId,
    resetEntityIdCounter,
    setEntityIdCounter
} from './IdGenerator.js';
export {
    SeededRNG,
    createRNG,
    getGlobalRNG,
    resetGlobalRNG,
    rngNext,
    rngNextInt,
    globalRNG
} from './SeededRNG.js';
export {
    serializeState,
    serializeUnit,
    deserializeUnit,
    hashState,
    compareStates
} from './StateSurface.js';
export {
    CommandQueue,
    CommandType,
    globalCommandQueue
} from './CommandQueue.js';
export {
    InputFactory,
    globalInputFactory
} from './InputFactory.js';
