# HU-TEST: R013 Phase 3 — Physics Visual Verification

**Status:** PENDING TOOLING (Requires `PHYSICS_HU_TOOLING.md` implementation)
**Owner:** Antigravity / Claude
**Objective:** Verify physics events (Rollover, Collision, Explosion) using browser-based Admin Tools.

## 1. Prerequisites
*   **Server:** Local build (`npm start`).
*   **Mode:** `?net=ws&dev=1` (Dev Tools Required).
*   **Host:** Must be Host (Slot 0) to use Admin Tools.

## 2. Test Cases

### Test A: Enable Physics (Runtime Toggle)
1.  **Open Debug Panel** (Top Right).
2.  **Locate "Physics Tools" folder.**
3.  **Click "Enable Physics" checkbox.**
    *   *Expected:* Server logs show "Physics: ON".
    *   *Expected:* UI Status panel shows `Physics: ON`.

### Test B: Spawn Obstacle (Rock)
1.  **Select a Unit** (Click to control).
2.  **Click "Spawn Rock (+5m)" button.**
    *   *Expected:* A Rock entity appears ~5 meters in front of the unit.
    *   *Expected:* It has a collider (though invisible without debug wireframe).

### Test C: Collision (Unit vs Rock)
1.  **Drive the unit forward strictly.**
2.  **Hit the spawned Rock.**
    *   *Expected:* Unit bounces off or stops abruptly.
    *   *Expected:* Status panel might flash `DYNAMIC` (Red) briefly.
    *   *Expected:* Rock might move if it is dynamic, or stay static if heavy.

### Test D: Explosion / Impulse (Mine)
1.  **Click "Spawn Mine (-2m)" button.**
    *   *Expected:* Mine appears behind unit.
2.  **Drive unit backward over the mine.**
    *   *Expected:* **BOOM.** Mine disappears.
    *   *Expected:* Unit is launched into the air (Upward + Radial Impulse).
    *   *Expected:* Status panel shows `DYNAMIC` (Red).
    *   *Expected:* Unit eventually lands and returns to `KINEMATIC` (Green).

### Test E: Slope Rollover (>45°)
1.  **Drive to a steep mountain.**
2.  **Ascend until angle > 45°.**
    *   *Expected:* Unit behaves normally (Kinematic) until threshold.
    *   *Expected:* At >45°, unit becomes `DYNAMIC` and tumbles down.
    *   *Expected:* User control (WASD) is disabled while tumbling.

## 3. Pass/Fail Criteria
*   **PASS:** All events (Spawn, Collision, Explosion, Rollover) are visually observable.
*   **FAIL:** Buttons do nothing, Physics doesn't enable, or Unit clips through Rock/Mine without event.
