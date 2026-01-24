# APPENDIX I: UI/UX PIPELINE

**Parent Document:** [MASTER_PLAN_FINAL_v2.md](../MASTER_PLAN_FINAL_v2.md)
**Decision:** Per Human Owner Q2 - Web Components / Vanilla Custom Elements
**Scope:** UI architecture, component design, acceptance criteria

---

## 1. UI Architecture

### 1.1 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Components | Web Components (Custom Elements) | Native, no framework dependency |
| Styling | CSS Variables + Shadow DOM | Encapsulation, theming |
| State | Custom Events + SimCore bindings | Unidirectional data flow |
| 3D | Three.js (existing) | Render layer |

### 1.2 Component Structure

```
src/UI/
├── components/
│   ├── base/
│   │   ├── base-component.js    # Shared base class
│   │   └── styles.css           # Global CSS variables
│   ├── game/
│   │   ├── command-queue-list.js
│   │   ├── command-queue-bar.js
│   │   ├── unit-info-panel.js
│   │   ├── resource-bar.js
│   │   └── minimap.js
│   ├── menus/
│   │   ├── main-menu.js
│   │   ├── lobby-browser.js
│   │   └── settings-panel.js
│   └── design/
│       ├── design-screen.js
│       ├── allocation-slider.js
│       └── blueprint-card.js
├── overlays/
│   ├── debug-overlay.js
│   └── loading-screen.js
└── index.js                     # Register all components
```

---

## 2. Base Component Pattern

### 2.1 BaseComponent Class

```javascript
// src/UI/components/base/base-component.js
export class BaseComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._state = {};
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  disconnectedCallback() {
    this.cleanup();
  }

  setState(newState) {
    this._state = { ...this._state, ...newState };
    this.render();
  }

  render() {
    // Override in subclass
  }

  setupEventListeners() {
    // Override in subclass
  }

  cleanup() {
    // Override in subclass
  }

  // Emit custom event
  emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, {
      bubbles: true,
      composed: true,
      detail
    }));
  }

  // CSS helper
  getStyles() {
    return `
      :host {
        display: block;
        font-family: var(--font-family, sans-serif);
        color: var(--text-color, #fff);
      }
    `;
  }
}
```

### 2.2 Usage Example

```javascript
// src/UI/components/game/unit-info-panel.js
import { BaseComponent } from '../base/base-component.js';

class UnitInfoPanel extends BaseComponent {
  static get observedAttributes() {
    return ['unit-id'];
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'unit-id' && newVal !== oldVal) {
      this.loadUnit(newVal);
    }
  }

  async loadUnit(unitId) {
    const unit = window.simCore?.getEntity(unitId);
    if (unit) {
      this.setState({ unit });
    }
  }

  render() {
    const { unit } = this._state;
    if (!unit) return;

    this.shadowRoot.innerHTML = `
      <style>
        ${this.getStyles()}
        .panel {
          background: rgba(0, 0, 0, 0.8);
          padding: 16px;
          border-radius: 8px;
        }
        .stat { margin: 8px 0; }
        .bar {
          height: 8px;
          background: #333;
          border-radius: 4px;
        }
        .bar-fill {
          height: 100%;
          background: var(--accent-color, #4CAF50);
          border-radius: 4px;
        }
      </style>
      <div class="panel">
        <h3>${unit.displayName || unit.id}</h3>
        <div class="stat">
          <label>HP</label>
          <div class="bar">
            <div class="bar-fill" style="width: ${unit.hp}%"></div>
          </div>
        </div>
        <div class="stat">
          <label>Energy</label>
          <div class="bar">
            <div class="bar-fill" style="width: ${unit.energy}%"></div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('unit-info-panel', UnitInfoPanel);
```

---

## 3. Phase 1 UI Components

### 3.1 Command Queue List

```javascript
// src/UI/components/game/command-queue-list.js
class CommandQueueList extends BaseComponent {
  render() {
    const { unit } = this._state;
    if (!unit) return;

    const clips = unit.queueState?.lanes?.LOCOMOTION || [];

    this.shadowRoot.innerHTML = `
      <style>
        ${this.getStyles()}
        .queue-list {
          background: rgba(0, 0, 0, 0.8);
          padding: 8px;
          max-height: 200px;
          overflow-y: auto;
        }
        .clip {
          padding: 8px;
          margin: 4px 0;
          background: #333;
          border-radius: 4px;
          display: flex;
          justify-content: space-between;
        }
        .clip.active { background: #4CAF50; }
        .controls {
          display: flex;
          gap: 8px;
          padding: 8px;
        }
        button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .play-btn { background: #4CAF50; }
        .pause-btn { background: #FF9800; }
      </style>
      <div class="queue-list">
        ${clips.map((clip, i) => `
          <div class="clip ${i === 0 ? 'active' : ''}">
            <span>${clip.actionType}</span>
            <span>${clip.estimatedDuration} ticks</span>
          </div>
        `).join('')}
      </div>
      <div class="controls">
        <button class="play-btn" id="play">Play</button>
        <button class="pause-btn" id="pause">Pause</button>
        <label>
          <input type="checkbox" id="loop" ${unit.queueState?.loopEnabled ? 'checked' : ''}>
          Loop
        </label>
      </div>
    `;

    this.shadowRoot.getElementById('play').onclick = () => {
      this.emit('queue-play', { unitId: unit.id });
    };

    this.shadowRoot.getElementById('pause').onclick = () => {
      this.emit('queue-pause', { unitId: unit.id });
    };

    this.shadowRoot.getElementById('loop').onchange = (e) => {
      this.emit('queue-loop-toggle', { unitId: unit.id, enabled: e.target.checked });
    };
  }
}

customElements.define('command-queue-list', CommandQueueList);
```

### 3.2 Command Queue Bar (Simple Timeline)

```javascript
// src/UI/components/game/command-queue-bar.js
class CommandQueueBar extends BaseComponent {
  render() {
    const { unit, currentTick } = this._state;
    if (!unit) return;

    const clips = unit.queueState?.lanes?.LOCOMOTION || [];
    const totalDuration = clips.reduce((sum, c) => sum + c.estimatedDuration, 0);

    this.shadowRoot.innerHTML = `
      <style>
        ${this.getStyles()}
        .bar-container {
          position: relative;
          height: 24px;
          background: #222;
          border-radius: 4px;
          overflow: hidden;
        }
        .now-line {
          position: absolute;
          left: 20%;
          top: 0;
          bottom: 0;
          width: 2px;
          background: #fff;
          z-index: 10;
        }
        .clip-bar {
          position: absolute;
          height: 100%;
          background: #4CAF50;
          border-right: 1px solid #222;
        }
        .clip-bar.active { background: #8BC34A; }
      </style>
      <div class="bar-container">
        <div class="now-line"></div>
        ${this.renderClips(clips, totalDuration)}
      </div>
    `;
  }

  renderClips(clips, totalDuration) {
    if (totalDuration === 0) return '';

    let offset = 0;
    return clips.map((clip, i) => {
      const width = (clip.estimatedDuration / totalDuration) * 80; // 80% of bar
      const left = 20 + (offset / totalDuration) * 80; // Start at 20% (now line)
      offset += clip.estimatedDuration;

      return `<div class="clip-bar ${i === 0 ? 'active' : ''}"
                   style="left: ${left}%; width: ${width}%"
                   title="${clip.actionType}: ${clip.estimatedDuration} ticks"></div>`;
    }).join('');
  }
}

customElements.define('command-queue-bar', CommandQueueBar);
```

---

## 4. CSS Variables (Theming)

```css
/* src/UI/components/base/styles.css */
:root {
  /* Colors */
  --bg-primary: rgba(0, 0, 0, 0.85);
  --bg-secondary: rgba(30, 30, 30, 0.9);
  --text-color: #ffffff;
  --text-muted: #888888;
  --accent-color: #4CAF50;
  --warning-color: #FF9800;
  --error-color: #F44336;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;

  /* Typography */
  --font-family: 'Segoe UI', sans-serif;
  --font-size-sm: 12px;
  --font-size-md: 14px;
  --font-size-lg: 18px;

  /* Borders */
  --border-radius: 4px;
  --border-color: #444;
}
```

---

## 5. UI Acceptance Criteria

### 5.1 Per-Component Criteria

| Component | Acceptance Criteria |
|-----------|---------------------|
| command-queue-list | Shows ordered clips, play/pause works, loop toggle works |
| command-queue-bar | Visualizes clips proportionally, now-line visible |
| unit-info-panel | Shows HP/energy bars, updates in real-time |
| design-screen | Allocation sliders sum to 100%, validates min allocation |
| lobby-browser | Lists lobbies, join button works, refresh works |

### 5.2 General Criteria

- [ ] No console errors on load
- [ ] Responsive to window resize
- [ ] Keyboard accessible (tab navigation)
- [ ] Works in Chrome, Firefox, Edge
- [ ] Shadow DOM isolation (no style leaks)
- [ ] Custom events propagate correctly

---

## 6. Phase 2 UI (Post-Demo)

| Component | Description |
|-----------|-------------|
| Full Timeline | Drag-to-reorder, gummy stretch handles |
| Training Mini-Games | Replace outcome slider with actual games |
| Social Features | Friends list, chat |
| Replay Controls | Playback bar, speed selector |
| Advanced Settings | Graphics quality, audio, keybinds |

---

*End of Appendix I*