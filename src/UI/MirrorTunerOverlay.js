/**
 * MirrorTunerOverlay — Always-visible draggable debug overlay for mirror mode tuning.
 *
 * Appears centered on screen. Draggable by its title bar.
 * Auto-shows when mirror mode activates in dev mode.
 */

import { makeDraggable } from './makeDraggable.js';

export class MirrorTunerOverlay {
    /** @param {Object} game */
    constructor(game) {
        this.game = game;
        this._interval = null;
        this._el = null;
        this._statsEl = null;
        this._build();
    }

    /** @private */
    _build() {
        const el = document.createElement('div');
        el.id = 'mirror-tuner-overlay';
        el.style.cssText = `
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.92);
            color: #0f0;
            font-family: 'Consolas','Monaco',monospace;
            font-size: 12px;
            padding: 0;
            border: 1px solid #0ff;
            border-radius: 6px;
            z-index: 16000;
            min-width: 270px;
            box-shadow: 0 4px 20px rgba(0,255,255,0.25);
            user-select: none;
        `;

        // Title bar (drag handle)
        const titleBar = document.createElement('div');
        titleBar.style.cssText = `
            background: rgba(0,255,255,0.15);
            padding: 6px 12px;
            border-radius: 5px 5px 0 0;
            border-bottom: 1px solid #0aa;
            font-weight: bold; color: #0ff; font-size: 13px;
            display: flex; justify-content: space-between; align-items: center;
        `;
        titleBar.innerHTML = '<span>MIRROR TUNER</span><span style="color:#0aa;font-size:10px;">drag to move</span>';
        el.appendChild(titleBar);

        // Content area
        const content = document.createElement('div');
        content.style.cssText = 'padding: 10px 12px;';

        // Toggle: Smooth Lerp ON/OFF
        this._addToggle(content, 'Smooth Lerp', true, (val) => {
            this.game._mirrorLerpEnabled = val;
        });

        // Slider: Lerp Speed (exponential approach factor, 0.01=sluggish, 1.0=instant snap)
        this._addSlider(content, 'Lerp Speed', 0.01, 0.5, 0.01, 0.12, '', (val) => {
            this.game._positionSyncLerpSpeed = val;
        });

        // --- Mirror mode controls (only useful if SERVER_SNAPSHOT active) ---
        const mirrorLabel = document.createElement('div');
        mirrorLabel.style.cssText = 'color:#666; font-size:10px; margin:6px 0 4px; border-top:1px dashed #333; padding-top:4px;';
        mirrorLabel.textContent = 'Mirror mode (if active):';
        content.appendChild(mirrorLabel);

        this._addSlider(content, 'Interp Delay', 0, 300, 10, 100, 'ms', (val) => {
            if (this.game._snapshotBuffer) this.game._snapshotBuffer.interpDelayMs = val;
        });

        this._addSlider(content, 'Max Extrap', 0, 200, 10, 0, 'ms', (val) => {
            if (this.game._snapshotBuffer) this.game._snapshotBuffer._maxExtrapolateMs = val;
        });

        this._addSlider(content, 'EMA Alpha', 0.01, 1.0, 0.01, 0.1, '', (val) => {
            if (this.game._snapshotBuffer) this.game._snapshotBuffer._emaAlpha = val;
        });

        // Stats separator
        const sep = document.createElement('div');
        sep.style.cssText = 'border-top:1px dashed #555; margin:8px 0 6px 0;';
        content.appendChild(sep);

        this._statsEl = document.createElement('div');
        this._statsEl.style.cssText = 'font-size:11px; line-height:1.6; color:#0a0;';
        content.appendChild(this._statsEl);

        el.appendChild(content);
        this._el = el;
        document.body.appendChild(el);

        // Make draggable via title bar
        makeDraggable(el, titleBar);

        // Start live update
        this._interval = setInterval(() => this._updateStats(), 100);
        this._updateStats();
    }

    /** @private */
    _addToggle(parent, label, initial, onChange) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;';

        const lbl = document.createElement('span');
        lbl.style.cssText = 'color:#aaa; font-size:11px;';
        lbl.textContent = label;
        row.appendChild(lbl);

        let state = initial;
        const btn = document.createElement('button');
        const applyStyle = () => {
            btn.textContent = state ? 'ON' : 'OFF';
            btn.style.cssText = `
                background:${state ? '#1a1' : '#a11'}; color:#fff; border:none;
                padding:2px 12px; border-radius:3px; cursor:pointer;
                font-family:'Consolas',monospace; font-size:11px; min-width:42px;
            `;
        };
        applyStyle();
        btn.addEventListener('click', () => { state = !state; applyStyle(); onChange(state); });
        row.appendChild(btn);
        parent.appendChild(row);
    }

    /** @private */
    _addSlider(parent, label, min, max, step, initial, unit, onChange) {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:5px;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; font-size:11px;';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'color:#aaa;';
        lbl.textContent = label;
        header.appendChild(lbl);
        const valSpan = document.createElement('span');
        valSpan.style.cssText = 'color:#ff0; min-width:55px; text-align:right;';
        valSpan.textContent = `${initial}${unit}`;
        header.appendChild(valSpan);
        row.appendChild(header);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min; slider.max = max; slider.step = step; slider.value = initial;
        slider.style.cssText = 'width:100%; height:16px; margin:2px 0; accent-color:#0ff; cursor:pointer;';
        slider.addEventListener('input', () => {
            const val = parseFloat(slider.value);
            valSpan.textContent = `${step < 1 ? val.toFixed(2) : val}${unit}`;
            onChange(val);
        });
        row.appendChild(slider);
        parent.appendChild(row);
    }

    /** @private */
    _updateStats() {
        const g = this.game;
        let h = '';

        // Mode indicator
        const mode = g._mirrorMode ? 'MIRROR (Phase 2A)' : 'POSITION_SYNC (Phase 1)';
        const modeColor = g._mirrorMode ? '#0f0' : '#fa0';
        h += `<div><span style="color:#888;">Mode:</span> <span style="color:${modeColor};font-weight:bold;">${mode}</span></div>`;

        // Lerp state
        h += `<div><span style="color:#888;">Lerp:</span> <span style="color:${g._mirrorLerpEnabled ? '#0f0' : '#f55'};">${g._mirrorLerpEnabled ? 'ON' : 'OFF (snap)'}</span>`;
        h += `  <span style="color:#888;">Speed:</span> ${g._positionSyncLerpSpeed.toFixed(2)}</div>`;

        // Count synced remote units
        let syncCount = 0;
        if (g.units) {
            for (const u of g.units) {
                if (u && u._syncReceived) syncCount++;
            }
        }
        h += `<div><span style="color:#888;">Synced units:</span> <span style="color:#ff0;">${syncCount}</span>`;
        h += `  <span style="color:#888;">Total:</span> ${g.units ? g.units.filter(Boolean).length : 0}</div>`;

        // Mirror mode buffer stats (if active)
        const buf = g._snapshotBuffer;
        if (g._mirrorMode && buf) {
            const stats = buf.getArrivalStats();
            const pair = buf.getInterpolationPair();
            h += `<div><span style="color:#888;">Buf:</span> <span style="color:#ff0;">${buf.size}</span>`;
            h += `  <span style="color:#888;">UF:</span> <span style="color:${buf.underflowCount > 0 ? '#f55' : '#0a0'};">${buf.underflowCount}</span>`;
            h += `  <span style="color:#888;">α:</span> <span style="color:#0ff;">${pair.alpha.toFixed(3)}</span></div>`;
            if (stats.count > 0) {
                h += `<div><span style="color:#888;">Arrival:</span> ${stats.mean.toFixed(0)}ms`;
                h += ` <span style="color:#666;">[${stats.min}–${stats.max}]</span></div>`;
            }
        }

        this._statsEl.innerHTML = h;
    }

    destroy() {
        if (this._interval) { clearInterval(this._interval); this._interval = null; }
        if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    }
}
