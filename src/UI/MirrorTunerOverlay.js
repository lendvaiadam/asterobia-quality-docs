/**
 * MirrorTunerOverlay — Always-visible debug overlay for mirror mode interpolation tuning.
 *
 * Renders directly on screen (bottom-left) without any menu toggle.
 * Auto-shows when mirror mode activates in dev mode.
 *
 * Controls:
 *   - Smooth Lerp ON/OFF toggle
 *   - Interp Delay slider (0–300ms)
 *   - Max Extrap slider (0–200ms)
 *   - EMA Alpha slider (0.01–1.0)
 *
 * Live stats (updated every 100ms):
 *   - Buffer size, underflow count, highest tick
 *   - Current alpha, smoothed clock offset
 *   - Arrival interval mean [min–max]
 */

export class MirrorTunerOverlay {
    /**
     * @param {Object} game - Game instance (needs _snapshotBuffer, _mirrorLerpEnabled)
     */
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
            bottom: 12px;
            left: 12px;
            background: rgba(0,0,0,0.88);
            color: #0f0;
            font-family: 'Consolas','Monaco',monospace;
            font-size: 12px;
            padding: 10px 14px;
            border: 1px solid #0ff;
            border-radius: 6px;
            z-index: 16000;
            min-width: 260px;
            box-shadow: 0 2px 12px rgba(0,255,255,0.15);
            user-select: none;
        `;

        // Title
        const title = document.createElement('div');
        title.style.cssText = 'font-weight:bold; color:#0ff; margin-bottom:8px; font-size:13px;';
        title.textContent = 'MIRROR TUNER';
        el.appendChild(title);

        // Toggle: Smooth Lerp
        this._lerpBtn = this._addToggle(el, 'Smooth Lerp', true, (val) => {
            this.game._mirrorLerpEnabled = val;
        });

        // Slider: interpDelayMs
        this._addSlider(el, 'Interp Delay', 0, 300, 10, 100, 'ms', (val) => {
            if (this.game._snapshotBuffer) this.game._snapshotBuffer.interpDelayMs = val;
        });

        // Slider: maxExtrapolateMs
        this._addSlider(el, 'Max Extrap', 0, 200, 10, 0, 'ms', (val) => {
            if (this.game._snapshotBuffer) this.game._snapshotBuffer._maxExtrapolateMs = val;
        });

        // Slider: emaAlpha
        this._addSlider(el, 'EMA Alpha', 0.01, 1.0, 0.01, 0.1, '', (val) => {
            if (this.game._snapshotBuffer) this.game._snapshotBuffer._emaAlpha = val;
        });

        // Stats area
        const sep = document.createElement('div');
        sep.style.cssText = 'border-top:1px dashed #555; margin:8px 0 6px 0;';
        el.appendChild(sep);

        this._statsEl = document.createElement('div');
        this._statsEl.style.cssText = 'font-size:11px; line-height:1.6; color:#0a0;';
        el.appendChild(this._statsEl);

        this._el = el;
        document.body.appendChild(el);

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
        btn.addEventListener('click', () => {
            state = !state;
            applyStyle();
            onChange(state);
        });
        row.appendChild(btn);
        parent.appendChild(row);
        return btn;
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
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = initial;
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
        const buf = this.game._snapshotBuffer;
        if (!buf || !this.game._mirrorMode) {
            this._statsEl.innerHTML = '<span style="color:#666;">Waiting for mirror mode...</span>';
            return;
        }

        const stats = buf.getArrivalStats();
        const pair = buf.getInterpolationPair();
        const a = pair.alpha;
        const uf = buf.underflowCount;

        let h = '';
        h += `<div>`;
        h += `<span style="color:#888;">Buf:</span> <span style="color:#ff0;">${buf.size}</span>`;
        h += `  <span style="color:#888;">UF:</span> <span style="color:${uf > 0 ? '#f55' : '#0a0'};">${uf}</span>`;
        h += `  <span style="color:#888;">Tick:</span> ${buf.highestTick}`;
        h += `</div>`;
        h += `<div>`;
        h += `<span style="color:#888;">α:</span> <span style="color:#0ff;">${a.toFixed(3)}</span>`;
        h += `  <span style="color:#888;">Offset:</span> ${buf.smoothedOffset.toFixed(0)}ms`;
        h += `</div>`;
        if (stats.count > 0) {
            h += `<div><span style="color:#888;">Arrival:</span> ${stats.mean.toFixed(0)}ms`;
            h += ` <span style="color:#666;">[${stats.min}–${stats.max}]</span></div>`;
        }
        this._statsEl.innerHTML = h;
    }

    /** Remove overlay and stop updates. */
    destroy() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        if (this._el && this._el.parentNode) {
            this._el.parentNode.removeChild(this._el);
        }
    }
}
