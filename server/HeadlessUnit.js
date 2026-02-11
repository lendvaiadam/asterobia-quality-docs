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

    /** @type {number} Fixed movement speed (world units per second) */
    static MOVE_SPEED = 2.0;

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
     * Process a MOVE_INPUT command: convert WASD booleans to velocity.
     * Diagonal normalization prevents √2 speed boost.
     *
     * @param {Object} command - { type: 'MOVE_INPUT', forward, backward, left, right }
     */
    applyInput(command) {
        if (command.type !== 'MOVE_INPUT') return;

        let dx = 0;
        let dz = 0;

        if (command.forward)  dz -= 1;
        if (command.backward) dz += 1;
        if (command.left)     dx -= 1;
        if (command.right)    dx += 1;

        // Diagonal normalization: prevent √2 speed boost
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0) {
            dx /= len;
            dz /= len;
        }

        this.velocity.x = dx * HeadlessUnit.MOVE_SPEED;
        this.velocity.z = dz * HeadlessUnit.MOVE_SPEED;
        this.speed = len > 0 ? HeadlessUnit.MOVE_SPEED : 0;

        // Update heading when moving
        if (len > 0) {
            this.heading = Math.atan2(dx, -dz);
        }
    }
}
