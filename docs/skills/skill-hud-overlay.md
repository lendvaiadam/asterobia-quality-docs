# SKILL: HUD Overlay

**ID**: `skill-hud-overlay`
**Role**: Frontend / UI
**Status**: ACTIVE

---

## 1. Purpose
Implement "In-World" UI elements that overlay the 3D scene, such as health bars, selection boxes, minimaps, and resource counters.

## 2. Scope
- Floating labels / Health bars.
- Minimap rendering (Canvas or Three.js).
- Selection indicators (Unit circles, drag boxes).
- Tooltips.

## 3. Hard Constraints (MUST NOT)
- **NO Menu UI**: Must NOT handle main menus, settings, or modals (Use `skill-ui-vanilla`).
- **NO Deep Query**: Must NOT deeply query SimCore logic. Should receive data via events or lightweight props.
- **NO Logic Implementation**: Must NOT implement game rules (e.g., "if health < 0 die") inside the HUD.

## 4. Triggers (When to Use)
- Adding unit selection feedback.
- Implementing Fog of War visualization on minimap.
- Displaying damage numbers.

## 5. Checklist
- [ ] HUD elements track 3D positions correctly.
- [ ] Performance: minimal DOM reflows (use Canvas or transformed CSS layers).
- [ ] Visibility: elements hide when object is off-screen or culled.
- [ ] Accessibility: Sufficient contrast.

## 6. Usage Examples

### A. Floating Health Bar
```javascript
// Project 3D pos to 2D screen coords
const vector = unit.position.clone().project(camera);
healthBar.style.left = `${(vector.x + 1) * width / 2}px`;
healthBar.style.top = `${(-vector.y + 1) * height / 2}px`;
```

## 7. Out of Scope
- Main Game HTML/CSS (Use `skill-ui-vanilla`).
- 3D Rendering (Use Three.js directly).
