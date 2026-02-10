/**
 * HeadlessUnit - Minimal server-side unit representation.
 *
 * Pure data object: position, velocity, heading, HP, ownership.
 * No Three.js, no mesh, no rendering. Suitable for authoritative server tick.
 *
 * @module server/HeadlessUnit
 */

export class HeadlessUnit {
    /**
     * @param {number} id - Deterministic entity ID (from IdGenerator)
     * @param {number} ownerSlot - Player slot that owns this unit (economic identity)
     */
    constructor(id, ownerSlot) {
        /** @type {number} */
        this.id = id;

        /** @type {number} Economic owner slot */
        this.ownerSlot = ownerSlot;

        /** @type {{ x: number, y: number, z: number }} World position */
        this.position = { x: 0, y: 0, z: 0 };

        /** @type {{ x: number, y: number, z: number }} Current velocity */
        this.velocity = { x: 0, y: 0, z: 0 };

        /** @type {number} Heading in radians */
        this.heading = 0;

        /** @type {number} Current speed scalar */
        this.speed = 0;

        /** @type {number} Hit points */
        this.hp = 100;

        /** @type {number|null} Slot currently controlling this unit (driver) */
        this.selectedBySlot = null;
    }

    /**
     * Produce a minimal JSON-safe snapshot for network transmission.
     * Uses short keys to minimize bandwidth.
     *
     * @returns {{ id: number, ownerSlot: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, heading: number, speed: number, hp: number }}
     */
    toSnapshot() {
        return {
            id: this.id,
            ownerSlot: this.ownerSlot,
            px: this.position.x,
            py: this.position.y,
            pz: this.position.z,
            vx: this.velocity.x,
            vy: this.velocity.y,
            vz: this.velocity.z,
            heading: this.heading,
            speed: this.speed,
            hp: this.hp
        };
    }

    /**
     * Process a movement/action command for this unit.
     * Phase 0: stub -- will be filled in when ENABLE_COMMAND_EXECUTION lands.
     *
     * @param {Object} command - Command object from CommandQueue
     */
    applyInput(command) {
        // Phase 0 stub: no-op
        // Phase 1 will implement MOVE, SET_PATH, CLOSE_PATH handling
    }
}
