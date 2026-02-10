/**
 * AdaptivePerformance - FPS-based automatic quality adjustment
 *
 * Monitors FPS and reduces/increases quality settings to maintain target framerate.
 * Target: 50 FPS
 * Below 40: start reducing quality
 * Below 25: everything to minimum
 */
export class AdaptivePerformance {
    constructor(game) {
        this.game = game;
        this.enabled = true;

        // FPS tracking
        this._frameTimes = [];
        this._lastTime = performance.now();
        this._sampleWindow = 60; // Average over 60 frames
        this._checkInterval = 2000; // Check every 2 seconds
        this._lastCheck = 0;

        // Quality level: 0 = minimum, 1 = low, 2 = medium, 3 = high
        this._qualityLevel = 2; // Start at medium (Basic preset values)
        this._lastAdjustTime = 0;
        this._adjustCooldown = 3000; // Don't adjust more often than every 3s

        // Track current FPS
        this.currentFPS = 60;

        // FPS display
        this._fpsDisplayEl = null;
        this._lastFPSDisplayUpdate = 0;
        this._fpsDisplayInterval = 500; // Update display every 500ms

        // Quality presets (each parameter has 4 levels: min/low/med/high)
        this._presets = {
            resolutionScale:   [0.4,  0.5,  0.7,  Math.min(window.devicePixelRatio, 2.0)],
            dustMaxParticles:  [5,    15,   25,   50],
            shadowMapSize:     [512,  1024, 2048, 4096],
            fowRes:            [128,  256,  512,  2048],
        };
    }

    /**
     * Called every frame from the render loop.
     * @param {number} now - performance.now() timestamp
     */
    update(now) {
        if (!this.enabled) return;

        // Track frame time
        const dt = now - this._lastTime;
        this._lastTime = now;
        this._frameTimes.push(dt);
        if (this._frameTimes.length > this._sampleWindow) {
            this._frameTimes.shift();
        }

        // Calculate average FPS
        if (this._frameTimes.length >= 10) {
            const avgDt = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
            this.currentFPS = 1000 / avgDt;
        }

        // Update FPS display (throttled to ~500ms)
        this._updateFPSDisplay(now);

        // Periodic quality check
        if (now - this._lastCheck < this._checkInterval) return;
        this._lastCheck = now;

        // Don't adjust too frequently
        if (now - this._lastAdjustTime < this._adjustCooldown) return;

        const fps = this.currentFPS;

        if (fps < 25 && this._qualityLevel > 0) {
            // Emergency: drop to minimum
            this._qualityLevel = 0;
            this._applyQuality();
            this._lastAdjustTime = now;
        } else if (fps < 40 && this._qualityLevel > 0) {
            // Below target: reduce one level
            this._qualityLevel--;
            this._applyQuality();
            this._lastAdjustTime = now;
        } else if (fps > 55 && this._qualityLevel < 3) {
            // Smooth enough: try increasing quality
            this._qualityLevel++;
            this._applyQuality();
            this._lastAdjustTime = now;
        }
    }

    /**
     * Update the on-screen FPS counter display.
     * Creates the DOM element on first call; updates text every ~500ms.
     * @private
     * @param {number} now - performance.now() timestamp
     */
    _updateFPSDisplay(now) {
        if (now - this._lastFPSDisplayUpdate < this._fpsDisplayInterval) return;
        this._lastFPSDisplayUpdate = now;

        // Create DOM element if it doesn't exist
        if (!this._fpsDisplayEl) {
            this._fpsDisplayEl = document.getElementById('fps-display');
            if (!this._fpsDisplayEl) {
                this._fpsDisplayEl = document.createElement('div');
                this._fpsDisplayEl.id = 'fps-display';
                Object.assign(this._fpsDisplayEl.style, {
                    position: 'fixed',
                    top: '5px',
                    right: '10px',
                    color: 'rgba(255,255,255,0.35)',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    zIndex: '9999',
                    pointerEvents: 'none',
                });
                document.body.appendChild(this._fpsDisplayEl);
            }
        }

        const fps = Math.round(this.currentFPS);
        if (this.game._isDevMode) {
            const quality = this.getQualityName();
            this._fpsDisplayEl.textContent = `${fps} FPS [${quality}]`;
        } else {
            this._fpsDisplayEl.textContent = `${fps} FPS`;
        }
    }

    /**
     * Apply current quality level to all systems
     * @private
     */
    _applyQuality() {
        const level = this._qualityLevel;
        const game = this.game;

        if (game._isDevMode) {
            console.log(`[AdaptivePerf] Quality: ${['MIN','LOW','MED','HIGH'][level]} (FPS: ${this.currentFPS.toFixed(1)})`);
        }

        // 1. Resolution scale
        const pixelRatio = this._presets.resolutionScale[level];
        if (game.renderer) {
            game.renderer.setPixelRatio(pixelRatio);
            game.renderer.setSize(window.innerWidth, window.innerHeight);
        }

        // 2. Dust particles per unit
        const dustMax = this._presets.dustMaxParticles[level];
        if (game.units) {
            game.units.forEach(u => {
                if (u && u.dustMaxParticles !== undefined) {
                    u.dustMaxParticles = dustMax;
                }
            });
        }

        // 3. Shadow map size (can only change at setup, so just record for reference)
        // Shadow map resize is expensive and causes flicker - only apply on major drops
        if (level === 0 && game.directionalLight && game.directionalLight.shadow) {
            const size = this._presets.shadowMapSize[level];
            game.directionalLight.shadow.mapSize.width = size;
            game.directionalLight.shadow.mapSize.height = size;
            game.directionalLight.shadow.map?.dispose();
            game.directionalLight.shadow.map = null;
        }

        // 4. FOW resolution (expensive to change - only on emergency)
        if (level <= 1 && game.fogOfWar && game.fogOfWar.setResolution) {
            game.fogOfWar.setResolution(this._presets.fowRes[level]);
        }
    }

    /**
     * Get current quality level name
     * @returns {string}
     */
    getQualityName() {
        return ['MIN', 'LOW', 'MED', 'HIGH'][this._qualityLevel];
    }
}
