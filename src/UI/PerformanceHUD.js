/**
 * PerformanceHUD - On-screen diagnostics for render/sim timing
 *
 * Toggle: Shift+P
 * Shows: renderFPS, simTicks/sec, fixedDtMs, accumulatorMs, alpha, interpolation calls/sec
 */

export class PerformanceHUD {
    constructor(game) {
        this.game = game;
        this._visible = false;
        this._element = null;

        // Counters (reset every second)
        this._renderFrames = 0;
        this._simTicks = 0;
        this._interpCalls = 0;

        // Displayed values
        this._renderFPS = 0;
        this._simTicksPerSec = 0;
        this._interpCallsPerSec = 0;

        // Timing
        this._lastSecond = performance.now();
        this._lastAlpha = 0;

        this._createHUD();
        this._bindToggle();
    }

    _createHUD() {
        const el = document.createElement('div');
        el.id = 'performance-hud';
        el.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            width: 280px;
            background: rgba(0, 0, 0, 0.85);
            color: #0ff;
            font-family: monospace;
            font-size: 12px;
            padding: 10px;
            border: 1px solid #0ff;
            border-radius: 4px;
            z-index: 10000;
            display: none;
        `;
        document.body.appendChild(el);
        this._element = el;
    }

    _bindToggle() {
        window.addEventListener('keydown', (e) => {
            if (e.shiftKey && e.code === 'KeyP') {
                this.toggle();
                e.preventDefault();
            }
        }, { capture: true });
    }

    toggle() {
        this._visible = !this._visible;
        this._element.style.display = this._visible ? 'block' : 'none';
    }

    /** Call every render frame from animate() */
    recordRenderFrame() {
        this._renderFrames++;
    }

    /** Call from simTick */
    recordSimTick() {
        this._simTicks++;
    }

    /** Call from applyInterpolatedRender */
    recordInterpCall() {
        this._interpCalls++;
    }

    /** Call every frame to update display */
    update() {
        if (!this._visible) return;

        const now = performance.now();
        const elapsed = now - this._lastSecond;

        // Update rates every second
        if (elapsed >= 1000) {
            this._renderFPS = Math.round(this._renderFrames * 1000 / elapsed);
            this._simTicksPerSec = Math.round(this._simTicks * 1000 / elapsed);
            this._interpCallsPerSec = Math.round(this._interpCalls * 1000 / elapsed);

            this._renderFrames = 0;
            this._simTicks = 0;
            this._interpCalls = 0;
            this._lastSecond = now;
        }

        // Get current values from SimLoop
        const simLoop = this.game.simLoop;
        const fixedDtMs = simLoop?.fixedDtMs ?? 0;
        const accumulatorMs = simLoop?.accumulatorMs ?? 0;
        const alpha = fixedDtMs > 0 ? Math.min(1, accumulatorMs / fixedDtMs) : 0;

        // Detect if alpha is varying
        const alphaChanged = Math.abs(alpha - this._lastAlpha) > 0.001;
        const alphaStatus = alphaChanged ? '✓ varying' : '⚠ STUCK';
        this._lastAlpha = alpha;

        // Color indicators
        const fpsColor = this._renderFPS >= 55 ? '#0f0' : (this._renderFPS >= 30 ? '#ff0' : '#f00');
        const tickColor = this._simTicksPerSec >= 18 && this._simTicksPerSec <= 22 ? '#0f0' : '#f00';
        const interpColor = this._interpCallsPerSec >= 50 ? '#0f0' : '#f00';
        const alphaColor = alphaChanged ? '#0f0' : '#f00';

        this._element.innerHTML = `
            <div style="border-bottom: 1px solid #0ff; margin-bottom: 8px; padding-bottom: 4px;">
                <strong>⚡ Performance HUD</strong>
                <span style="float: right; color: #888;">[Shift+P]</span>
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: ${fpsColor};">renderFPS: ${this._renderFPS}</span>
                <span style="color: #888;"> (target: 60)</span>
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: ${tickColor};">simTicks/sec: ${this._simTicksPerSec}</span>
                <span style="color: #888;"> (target: 20)</span>
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #888;">fixedDtMs: ${fixedDtMs}</span>
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #888;">accumulatorMs: ${accumulatorMs.toFixed(1)}</span>
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: ${alphaColor};">alpha: ${alpha.toFixed(3)}</span>
                <span style="color: ${alphaColor};"> ${alphaStatus}</span>
            </div>
            <div>
                <span style="color: ${interpColor};">interp calls/sec: ${this._interpCallsPerSec}</span>
                <span style="color: #888;"> (target: ~60)</span>
            </div>
        `;
    }
}
