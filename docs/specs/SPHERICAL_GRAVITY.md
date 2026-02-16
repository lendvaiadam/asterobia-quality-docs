# Spherical Gravity Implementation Guide (Rapier3D)

**Context:** Asterobia (Game 3) uses a spherical planet.
**Problem:** Rapier3D (and most physics engines like Cannon, Ammo) defaults to "Flat Earth" gravity (a constant `y: -9.81` vector).
**Solution:** Disable global gravity and apply a custom force *towards the planet center* for every object, every tick.

---

## 1. The Strategy: "Zero Global, Manual Local"

Instead of hacking the engine, we use its standard API in a specific way:

1.  **Initialize World with Zero Gravity:**
    Tell Rapier there is *no* global gravity. This prevents objects from falling "down" (Y-axis).
2.  **Apply Force Per Tick:**
    In the physics loop, iterate over every dynamic body, calculate the direction to `(0,0,0)`, and push it.

---

## 2. Implementation Reference

This logic is already implemented and verified in `server/PhysicsWorld.js`.

### Step A: Initialization
```javascript
// server/PhysicsWorld.js
this._world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // ZERO GRAVITY
```

### Step B: The Gravity Loop
This runs inside `step()`, **before** `world.step()`.

```javascript
// server/PhysicsWorld.js

_applySphericalGravity() {
    const G = this.gravityMagnitude; // 9.81
    if (G <= 0) return;

    this._world.bodies.forEach((body) => {
        // Only apply to DYNAMIC bodies (Kinematic/Fixed don't need gravity)
        if (!body.isDynamic()) return;

        const pos = body.translation();
        
        // 1. Calculate direction to center (0,0,0)
        // In simple terms: direction = -position (normalized)
        const lenSq = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
        if (lenSq < 1e-6) return; // At origin, do nothing

        const len = Math.sqrt(lenSq);
        const mass = body.mass();       // Heavier objects need more force (F=ma)
        const forceMagnitude = G * mass;

        // 2. Apply Force
        // F = direction * magnitude
        body.addForce({
            x: (-pos.x / len) * forceMagnitude,
            y: (-pos.y / len) * forceMagnitude,
            z: (-pos.z / len) * forceMagnitude
        }, true); // true = wake up sleeping body
    });
}
```

---

## 3. Why `addForce` and not `setLinvel`?
*   **Forces accumulate:** You can have gravity + explosion + thruster all acting at once.
*   **Stability:** Rapier solves forces integrated over time.
*   **Mass correct:** `F = m * a`. By multiplying by mass, we ensure all objects fall at the same acceleration (`9.81`), regardless of weight (Galileo's principle).

## 4. Sub-stepping (Critical)
Since gravity is a continuous force, applying it once per frame (e.g. 20Hz) might be jittery. We apply it **per physics sub-step**.

```javascript
// server/PhysicsWorld.js
step(dt) {
    for (let i = 0; i < this.subSteps; i++) {
        this._applySphericalGravity(); // Apply force
        this._world.step(this._eventQueue); // Advance simulation
    }
}
```
This ensures smooth, stable orbits and falling.

---
**Status:** This is implemented in `server/PhysicsWorld.js` and verified correct.
