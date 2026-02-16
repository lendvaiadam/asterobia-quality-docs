/**
 * SphereMath — Pure JavaScript vector and quaternion math for sphere operations.
 *
 * No Three.js dependency. Used by server-side HeadlessUnit for spherical terrain movement.
 * All operations are deterministic (no randomness, no Date.now).
 *
 * @module server/SphereMath
 */

// ========================================
// Vec3 operations (plain { x, y, z } objects)
// ========================================

export const Vec3 = {
    /**
     * @param {number} [x=0]
     * @param {number} [y=0]
     * @param {number} [z=0]
     * @returns {{ x: number, y: number, z: number }}
     */
    create(x = 0, y = 0, z = 0) {
        return { x, y, z };
    },

    /** @returns {number} */
    length(v) {
        return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    },

    /** @returns {number} */
    lengthSq(v) {
        return v.x * v.x + v.y * v.y + v.z * v.z;
    },

    /**
     * Normalize a vector. Returns {0,1,0} fallback for zero-length input.
     * @returns {{ x: number, y: number, z: number }}
     */
    normalize(v) {
        const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (len < 1e-10) return { x: 0, y: 1, z: 0 };
        return { x: v.x / len, y: v.y / len, z: v.z / len };
    },

    /** @returns {{ x: number, y: number, z: number }} */
    scale(v, s) {
        return { x: v.x * s, y: v.y * s, z: v.z * s };
    },

    /** @returns {{ x: number, y: number, z: number }} */
    add(a, b) {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    },

    /** @returns {{ x: number, y: number, z: number }} */
    sub(a, b) {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    },

    /** @returns {number} */
    dot(a, b) {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    },

    /** @returns {{ x: number, y: number, z: number }} */
    cross(a, b) {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        };
    },

    /**
     * Project vector v onto the plane perpendicular to unit normal n.
     * Result = v - n * dot(v, n)
     * @returns {{ x: number, y: number, z: number }}
     */
    projectOnPlane(v, n) {
        const d = v.x * n.x + v.y * n.y + v.z * n.z;
        return { x: v.x - n.x * d, y: v.y - n.y * d, z: v.z - n.z * d };
    }
};

// ========================================
// Quaternion operations (plain { x, y, z, w } objects)
// ========================================

export const Quat = {
    /** @returns {{ x: number, y: number, z: number, w: number }} */
    identity() {
        return { x: 0, y: 0, z: 0, w: 1 };
    },

    /** @returns {{ x: number, y: number, z: number, w: number }} */
    normalize(q) {
        const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
        if (len < 1e-10) return { x: 0, y: 0, z: 0, w: 1 };
        return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
    },

    /**
     * Create quaternion from axis-angle.
     * @param {{ x: number, y: number, z: number }} axis - Must be normalized
     * @param {number} angle - Radians
     * @returns {{ x: number, y: number, z: number, w: number }}
     */
    fromAxisAngle(axis, angle) {
        const half = angle * 0.5;
        const s = Math.sin(half);
        return {
            x: axis.x * s,
            y: axis.y * s,
            z: axis.z * s,
            w: Math.cos(half)
        };
    },

    /**
     * Rotate a vector by a quaternion: v' = q * v * q^-1
     * @param {{ x: number, y: number, z: number, w: number }} q
     * @param {{ x: number, y: number, z: number }} v
     * @returns {{ x: number, y: number, z: number }}
     */
    rotateVec3(q, v) {
        // Expanded Hamilton product for performance (avoids intermediate quaternion multiply)
        const ix =  q.w * v.x + q.y * v.z - q.z * v.y;
        const iy =  q.w * v.y + q.z * v.x - q.x * v.z;
        const iz =  q.w * v.z + q.x * v.y - q.y * v.x;
        const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

        return {
            x: ix * q.w - iw * q.x - iy * q.z + iz * q.y,
            y: iy * q.w - iw * q.y - iz * q.x + ix * q.z,
            z: iz * q.w - iw * q.z - ix * q.y + iy * q.x
        };
    },

    /**
     * Build a "look rotation" quaternion (Three.js convention).
     * Maps local -Z to `forward` and local +Y to `up`.
     *
     * This matches Three.js Matrix4.lookAt → Quaternion.setFromRotationMatrix,
     * ensuring the server quaternion is directly usable by the client's mesh.quaternion.
     *
     * @param {{ x: number, y: number, z: number }} forward - Direction the unit faces (world space, normalized)
     * @param {{ x: number, y: number, z: number }} up - Surface normal / up direction (world space, normalized)
     * @returns {{ x: number, y: number, z: number, w: number }} Normalized quaternion
     */
    lookRotation(forward, up) {
        // z axis = -forward (Three.js: mesh default faces -Z)
        const zx = -forward.x, zy = -forward.y, zz = -forward.z;

        // x axis = normalize(cross(up, z))
        let xx = up.y * zz - up.z * zy;
        let xy = up.z * zx - up.x * zz;
        let xz = up.x * zy - up.y * zx;
        let xLen = Math.sqrt(xx * xx + xy * xy + xz * xz);

        if (xLen < 1e-6) {
            // Degenerate: up and z are parallel. Pick fallback.
            const fallback = Math.abs(up.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
            xx = fallback.y * zz - fallback.z * zy;
            xy = fallback.z * zx - fallback.x * zz;
            xz = fallback.x * zy - fallback.y * zx;
            xLen = Math.sqrt(xx * xx + xy * xy + xz * xz);
        }

        xx /= xLen; xy /= xLen; xz /= xLen;

        // y axis = normalize(cross(z, x)) — recomputed for orthogonality
        let yx = zy * xz - zz * xy;
        let yy = zz * xx - zx * xz;
        let yz = zx * xy - zy * xx;
        const yLen = Math.sqrt(yx * yx + yy * yy + yz * yz);
        yx /= yLen; yy /= yLen; yz /= yLen;

        // Rotation matrix columns: [x, y, z]
        // m[col][row]: m00=xx, m10=xy, m20=xz, m01=yx, m11=yy, m21=yz, m02=zx, m12=zy, m22=zz
        const m00 = xx, m01 = yx, m02 = zx;
        const m10 = xy, m11 = yy, m12 = zy;
        const m20 = xz, m21 = yz, m22 = zz;

        // Matrix → quaternion (Shepperd's method)
        const trace = m00 + m11 + m22;
        let qx, qy, qz, qw;

        if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1.0);
            qw = 0.25 / s;
            qx = (m21 - m12) * s;
            qy = (m02 - m20) * s;
            qz = (m10 - m01) * s;
        } else if (m00 > m11 && m00 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
            qw = (m21 - m12) / s;
            qx = 0.25 * s;
            qy = (m01 + m10) / s;
            qz = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
            qw = (m02 - m20) / s;
            qx = (m01 + m10) / s;
            qy = 0.25 * s;
            qz = (m12 + m21) / s;
        } else {
            const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
            qw = (m10 - m01) / s;
            qx = (m02 + m20) / s;
            qy = (m12 + m21) / s;
            qz = 0.25 * s;
        }

        return Quat.normalize({ x: qx, y: qy, z: qz, w: qw });
    },

    /**
     * Spherical linear interpolation between two quaternions.
     * @param {{ x:number, y:number, z:number, w:number }} a
     * @param {{ x:number, y:number, z:number, w:number }} b
     * @param {number} t - Interpolation factor [0, 1]
     * @returns {{ x:number, y:number, z:number, w:number }}
     */
    slerp(a, b, t) {
        let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
        // Ensure shortest path
        let bx = b.x, by = b.y, bz = b.z, bw = b.w;
        if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
        if (dot > 0.9995) {
            // Very close — linear interpolation to avoid div by zero
            return Quat.normalize({
                x: a.x + (bx - a.x) * t,
                y: a.y + (by - a.y) * t,
                z: a.z + (bz - a.z) * t,
                w: a.w + (bw - a.w) * t
            });
        }
        const theta = Math.acos(dot);
        const sinTheta = Math.sin(theta);
        const wa = Math.sin((1 - t) * theta) / sinTheta;
        const wb = Math.sin(t * theta) / sinTheta;
        return {
            x: a.x * wa + bx * wb,
            y: a.y * wa + by * wb,
            z: a.z * wa + bz * wb,
            w: a.w * wa + bw * wb
        };
    }
};
