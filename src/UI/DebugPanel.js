import { Pane } from 'tweakpane';
import { BUILD_HASH, BUILD_DATE } from '../buildInfo.js';
import { Unit } from '../Entities/Unit.js'; // Import Unit for static flags

export class DebugPanel {
    constructor(game) {
        this.game = game;
        this.pane = new Pane({ title: 'Debug Console', expanded: false });
        this.autoRegenerate = true;
        this.performanceMode = false;

        // === BUILD INFO - Top of panel ===
        this.pane.addBinding({ build: `${BUILD_HASH} (${BUILD_DATE})` }, 'build', {
            label: '🔧 Build',
            readonly: true
        });

        // === PROFILER & TOGGLES ===
        this.setupProfiler();

        // === PERFORMANCE MODE ===
        this.pane.addBinding(this, 'performanceMode', { label: '⚡ PERFORMANCE MODE' })
            .on('change', (ev) => this.setPerformanceMode(ev.value));

        this.setupTerrainControls();
        this.setupUnitControls();
    }

    setupProfiler() {
        // Inject Stats.js
        const script = document.createElement('script');
        script.onload = () => {
            this.stats = new Stats();
            document.body.appendChild(this.stats.dom);
            this.stats.dom.style.left = 'unset';
            this.stats.dom.style.right = '0px';
            this.stats.dom.style.top = 'unset';
            this.stats.dom.style.bottom = '0px';

            // Hook into game loop if possible, or requestAnimationFrame loop
            const updateStats = () => {
                this.stats.update();
                requestAnimationFrame(updateStats);
            };
            requestAnimationFrame(updateStats);
        };
        script.src = '//mrdoob.github.io/stats.js/build/stats.min.js';
        document.head.appendChild(script);

        const folder = this.pane.addFolder({ title: 'Profiler & Visibility', expanded: false });

        const toggles = {
            terrain: true,
            water: true,
            rocks: true,
            units: true,
            stars: true,
            fowStars: true,
            dust: true,
            tracks: true,
            shadows: true,
            clouds: true
        };

        // TERRAIN
        folder.addBinding(toggles, 'terrain').on('change', (ev) => {
            if (this.game.planet && this.game.planet.mesh) {
                this.game.planet.mesh.visible = ev.value;
            }
        });

        // WATER
        folder.addBinding(toggles, 'water').on('change', (ev) => {
            if (this.game.planet && this.game.planet.waterMesh) {
                this.game.planet.waterMesh.visible = ev.value;
            }
        });

        // ROCKS
        folder.addBinding(toggles, 'rocks').on('change', (ev) => {
            if (this.game.planet && this.game.planet.rockSystem && this.game.planet.rockSystem.rockGroup) {
                this.game.planet.rockSystem.rockGroup.visible = ev.value;
            }
        });

        // UNITS (Hide all units)
        folder.addBinding(toggles, 'units').on('change', (ev) => {
            if (this.game.units) {
                this.game.units.forEach(unit => {
                    if (unit && unit.mesh) {
                        unit.mesh.visible = ev.value;
                    }
                });
            }
        });

        // DUST (Static Flag + Group Visibility)
        folder.addBinding(toggles, 'dust').on('change', (ev) => {
            Unit.enableDust = ev.value;
            // Toggle visibility of EXISTING dust
            if (this.game.units) {
                this.game.units.forEach(u => {
                    if (u.dustGroup) u.dustGroup.visible = ev.value;
                });
            }
        });

        // === DUST PARTICLES CONTROLS ===
        const dustFolder = folder.addFolder({ title: 'Dust Particles', expanded: false });
        const dustConfig = {
            opacity: 0.1,
            spawnRate: 0.03
        };

        dustFolder.addBinding(dustConfig, 'opacity', {
            min: 0.01, max: 0.5, step: 0.01, label: 'Transparency'
        }).on('change', (ev) => {
            console.error('[Dust] Opacity changed to:', ev.value);
            if (this.game.units) {
                this.game.units.forEach(u => {
                    if (u) u.dustOpacity = ev.value;
                });
            }
        });

        dustFolder.addBinding(dustConfig, 'spawnRate', {
            min: 0.01, max: 0.2, step: 0.01, label: 'Frequency (lower=more)'
        }).on('change', (ev) => {
            console.error('[Dust] Spawn rate changed to:', ev.value);
            if (this.game.units) {
                this.game.units.forEach(u => {
                    if (u) u.dustSpawnInterval = ev.value;
                });
            }
        });

        // TRACKS (Static Flag + Group Visibility)
        folder.addBinding(toggles, 'tracks').on('change', (ev) => {
            Unit.enableTracks = ev.value;
            // Toggle visibility of EXISTING tracks
            if (this.game.units) {
                this.game.units.forEach(u => {
                    if (u.trackGroup) u.trackGroup.visible = ev.value;
                });
            }
        });

        // === TRACK CONTROLS ===
        const trackFolder = folder.addFolder({ title: 'Track Controls', expanded: false });
        const trackConfig = {
            opacity: 0.13,
            height: 0.02
        };

        trackFolder.addBinding(trackConfig, 'opacity', {
            min: 0.0, max: 1.0, step: 0.05, label: 'Opacity'
        }).on('change', (ev) => {
            if (this.game.units) {
                this.game.units.forEach(u => {
                    u.trackOpacity = ev.value;
                    if (u.trackInstancedMesh && u.trackInstancedMesh.material && u.trackInstancedMesh.material.userData.shader && u.trackInstancedMesh.material.userData.shader.uniforms.uTrackOpacity) {
                        // Update shader uniform
                        u.trackInstancedMesh.material.userData.shader.uniforms.uTrackOpacity.value = ev.value;
                    }
                });
            }
        });

        trackFolder.addBinding(trackConfig, 'height', {
            min: 0.01, max: 0.1, step: 0.005, label: 'HeightOffset'
        }).on('change', (ev) => {
            if (this.game.units) {
                this.game.units.forEach(u => {
                    u.trackHeightOffset = ev.value;
                });
            }
        });

        // PLANET SURFACE STARS (FOW STARS)
        // User Request: "nem látható területen lévő csillagos texturát is le kellene tudni kapcsolni"
        // Splitting into separate toggles as likely requested (assuming typo "keréknyom" -> "csillag")

        // BACKGROUND STARS
        folder.addBinding(toggles, 'stars', { label: 'Space Stars' }).on('change', (ev) => {
            if (this.game.stars) {
                this.game.stars.visible = ev.value;
            }
        });

        // SURFACE STARS
        // Add new key if not in object, or use existing if added
        if (toggles.fowStars === undefined) toggles.fowStars = true;

        folder.addBinding(toggles, 'fowStars', { label: 'FOW Stars' }).on('change', (ev) => {
            if (this.game.planet && this.game.planet.starField) {
                this.game.planet.starField.visible = ev.value;
            }
        });

        // SHADOWS
        folder.addBinding(toggles, 'shadows').on('change', (ev) => {
            this.updateShadowsState(ev.value);
        });

        // SHADOW OPACITY (Controlled by Ambient Light)
        // More ambient light = lighter (more transparent) shadows
        const shadowParams = { opacity: 0.7 }; // Default 30% transparent (1.0 - 0.3)
        folder.addBinding(shadowParams, 'opacity', {
            min: 0.0, max: 1.0, step: 0.05, label: 'Shadow Opacity'
        }).on('change', (ev) => {
            // High Opacity = Dark Shadow = Low Ambient
            // Low Opacity = Light Shadow = High Ambient
            // Base Ambient was 0.6. Let's map Opacity 1.0 -> Ambient 0.2, Opacity 0.0 -> Ambient 1.5
            const ambientIntensity = THREE.MathUtils.lerp(1.5, 0.2, ev.value);
            if (this.game.ambientLight) {
                this.game.ambientLight.intensity = ambientIntensity;
            }
        });

        // Initial application of shadow settings
        // Wait for next frame to ensure everything is loaded
        setTimeout(() => {
            this.updateShadowsState(toggles.shadows);
            // Apply initial opacity
            const initialAmbient = THREE.MathUtils.lerp(1.5, 0.2, shadowParams.opacity);
            if (this.game.ambientLight) {
                this.game.ambientLight.intensity = initialAmbient;
            }
        }, 100);

        // === GRAPHICS SETTINGS ===
        this.setupGraphicsControls();

        if (this.game) {
            this.game.enableLowSpecMode = () => {
                this.enableLowSpecMode();
            };
        }
    }

    enableLowSpecMode() {
        // Apply aggressive optimizations

        // 1. Lower Resolution
        if (this.game.renderer) {
            this.game.renderer.setPixelRatio(0.6); // 60% resolution
        }

        // 2. Disable Shadows Mode
        if (this.game.renderer) {
            this.game.renderer.shadowMap.enabled = false;
            this.game.renderer.shadowMap.autoUpdate = false;
            this.game.scene.traverse((obj) => {
                if (obj.material) obj.material.needsUpdate = true;
            });
        }
        if (this.game.sunLight) {
            this.game.sunLight.castShadow = false;
        }

        // 3. Reduce Planet Resolution
        if (this.game.planet) {
            this.game.planet.meshResolution = 100; // Low poly terrain
            this.regeneratePlanet();
        }

        // 4. Reduce FOW Resolution
        if (this.game.fogOfWar) {
            this.game.fogOfWar.setResolution(256);
        }

        // 5. Activate Performance Mode (Logs etc)
        this.setPerformanceMode(true);
        this.pane.expanded = false; // Collapse panel

        console.log("Low Spec Mode Activated via Script: Res=0.6, Shadows=OFF, Terrain=100");
    }

    setupGraphicsControls() {
        const folder = this.pane.addFolder({ title: 'Performance', expanded: false });

        // === PERFORMANCE PRESETS ===
        // Preset values: { resolutionScale, shadows, terrainRes, fowRes, dustPercent }
        const PRESETS = {
            basic: { resolutionScale: 0.6, shadows: false, terrainRes: 100, fowRes: 256, dustPercent: 25 },
            high: { resolutionScale: Math.min(window.devicePixelRatio, 2.0), shadows: true, terrainRes: 308, fowRes: 2048, dustPercent: 50 }
        };

        // Current parameter state
        this.perfParams = {
            mode: 'high', // 'basic', 'custom', 'high'
            resolutionScale: PRESETS.high.resolutionScale,
            shadows: PRESETS.high.shadows,
            terrainRes: PRESETS.high.terrainRes,
            fowRes: PRESETS.high.fowRes,
            dustPercent: PRESETS.high.dustPercent
        };

        // Mode Selector
        const modeBinding = folder.addBinding(this.perfParams, 'mode', {
            label: 'Mode',
            options: {
                'Basic': 'basic',
                'Custom': 'custom',
                'High': 'high'
            }
        }).on('change', (ev) => {
            if (ev.value === 'basic' || ev.value === 'high') {
                this.applyPerformancePreset(ev.value);
                folder.refresh();
            }
        });

        // Separator label
        folder.addBlade({ view: 'separator' });

        // === INDIVIDUAL PARAMETERS ===

        // Resolution Scale
        folder.addBinding(this.perfParams, 'resolutionScale', {
            label: 'Resolution',
            min: 0.3,
            max: Math.min(window.devicePixelRatio, 2.0),
            step: 0.1
        }).on('change', (ev) => {
            if (this.game.renderer) {
                this.game.renderer.setPixelRatio(ev.value);
            }
            this.switchToCustomIfNeeded();
        });

        // Shadows Toggle
        folder.addBinding(this.perfParams, 'shadows', {
            label: 'Shadows'
        }).on('change', (ev) => {
            if (this.game.renderer) {
                this.game.renderer.shadowMap.enabled = ev.value;
                this.game.renderer.shadowMap.autoUpdate = ev.value; // CRITICAL: Re-enable auto updates
                this.game.renderer.shadowMap.needsUpdate = true; // Force immediate update
                this.game.scene.traverse((obj) => {
                    if (obj.material) obj.material.needsUpdate = true;
                });
            }
            if (this.game.sunLight) {
                this.game.sunLight.castShadow = ev.value;
                this.game.sunLight.shadow.camera.updateProjectionMatrix();
            }
            this.switchToCustomIfNeeded();
        });

        // Terrain Resolution
        folder.addBinding(this.perfParams, 'terrainRes', {
            label: 'Terrain Detail',
            min: 50,
            max: 500,
            step: 50
        }).on('change', (ev) => {
            if (this.game.planet) {
                this.game.planet.meshResolution = ev.value;
                this.regeneratePlanet();
            }
            this.switchToCustomIfNeeded();
        });

        // FOW Resolution
        folder.addBinding(this.perfParams, 'fowRes', {
            label: 'Vision Quality',
            options: {
                'Very Low (256)': 256,
                'Low (512)': 512,
                'Medium (1024)': 1024,
                'High (2048)': 2048,
                'Ultra (4096)': 4096
            }
        }).on('change', (ev) => {
            if (this.game.fogOfWar) {
                this.game.fogOfWar.setResolution(ev.value);
            }
            this.switchToCustomIfNeeded();
        });

        // Dust Particles %
        folder.addBinding(this.perfParams, 'dustPercent', {
            label: 'Dust %',
            min: 10,
            max: 100,
            step: 10
        }).on('change', (ev) => {
            if (this.game.units) {
                this.game.units.forEach(u => {
                    if (u.dustMaxParticles !== undefined) {
                        u.dustMaxParticles = ev.value;
                    }
                });
            }
            this.switchToCustomIfNeeded();
        });

        this.perfFolder = folder;
    }

    applyPerformancePreset(presetName) {
        const PRESETS = {
            basic: { resolutionScale: 0.6, shadows: false, terrainRes: 100, fowRes: 256, dustPercent: 30 },
            high: { resolutionScale: Math.min(window.devicePixelRatio, 2.0), shadows: true, terrainRes: 308, fowRes: 2048, dustPercent: 60 }
        };

        const preset = PRESETS[presetName];
        if (!preset) return;

        // Update params
        this.perfParams.resolutionScale = preset.resolutionScale;
        this.perfParams.shadows = preset.shadows;
        this.perfParams.terrainRes = preset.terrainRes;
        this.perfParams.fowRes = preset.fowRes;
        this.perfParams.dustPercent = preset.dustPercent;

        // Apply to game
        if (this.game.renderer) {
            this.game.renderer.setPixelRatio(preset.resolutionScale);
            this.game.renderer.shadowMap.enabled = preset.shadows;
            this.game.renderer.shadowMap.autoUpdate = preset.shadows; // CRITICAL: Re-enable auto updates for HIGH mode
            this.game.renderer.shadowMap.needsUpdate = true; // Force immediate update
            this.game.scene.traverse((obj) => {
                if (obj.material) obj.material.needsUpdate = true;
            });
        }
        if (this.game.sunLight) {
            this.game.sunLight.castShadow = preset.shadows;
            this.game.sunLight.shadow.camera.updateProjectionMatrix();
        }
        if (this.game.planet) {
            this.game.planet.meshResolution = preset.terrainRes;
            this.regeneratePlanet();
        }
        if (this.game.fogOfWar) {
            this.game.fogOfWar.setResolution(preset.fowRes);
        }
        if (this.game.units) {
            this.game.units.forEach(u => {
                if (u.dustMaxParticles !== undefined) {
                    u.dustMaxParticles = preset.dustPercent;
                }
            });
        }

        // Also apply performance mode for basic
        if (presetName === 'basic') {
            this.setPerformanceMode(true);
            this.pane.expanded = false;
        } else {
            this.setPerformanceMode(false);
        }

        console.log(`Performance preset applied: ${presetName}`);
    }

    switchToCustomIfNeeded() {
        // Only switch if we're NOT already in custom mode
        if (this.perfParams.mode !== 'custom') {
            this.perfParams.mode = 'custom';
            if (this.perfFolder) {
                this.perfFolder.refresh();
            }
        }
    }

    /**
     * Performance Mode - disables all logging and non-essential debug features.
     */
    setPerformanceMode(enabled) {
        this.performanceMode = enabled;

        if (enabled) {
            // Disable all console methods except errors
            this._originalConsoleLog = console.log;
            this._originalConsoleWarn = console.warn;
            console.log = () => { };
            console.warn = () => { };

            // Hide NavMesh debug visualization
            if (this.game.navMesh) {
                this.game.navMesh.setDebugVisible(false);
            }

            // Hide vision helper
            if (this.game.visionHelper) {
                this.game.visionHelper.visible = false;
            }

            // Collapse all debug panels to reduce UI overhead
            if (this.game.navMeshDebug?.pane) {
                this.game.navMeshDebug.pane.expanded = false;
            }
            if (this.game.rockDebug?.pane) {
                this.game.rockDebug.pane.expanded = false;
            }
            if (this.game.cameraDebug?.pane) {
                this.game.cameraDebug.pane.expanded = false;
            }

            console.error('[Performance Mode] ENABLED - Logs disabled');
        } else {
            // Restore console methods
            if (this._originalConsoleLog) {
                console.log = this._originalConsoleLog;
            }
            if (this._originalConsoleWarn) {
                console.warn = this._originalConsoleWarn;
            }

            console.log('[Performance Mode] DISABLED - Logs restored');
        }
    }

    setupTerrainControls() {
        const folder = this.pane.addFolder({ title: 'Terrain', expanded: false });
        const params = this.game.planet.terrain.params;

        folder.addBinding({ version: '1.0.1' }, 'version', { label: 'Version', readonly: true });

        folder.addBinding(this, 'autoRegenerate', { label: 'Real-time Update' });

        folder.addBinding(params, 'radius', { min: 20, max: 200, label: 'Planet Radius' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });

        folder.addBinding(params, 'heightMultiplier', { min: 0.0, max: 10.0, label: 'Height' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });

        folder.addBinding(params, 'waterLevel', { min: -10.0, max: 10.0, label: 'Water Level' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });

        // Water Transparency
        folder.addBinding(params, 'waterOpacity', { min: 0.0, max: 1.0, label: 'Water Opacity' }).on('change', () => {
            if (this.game.planet.waterMesh) {
                this.game.planet.waterMesh.material.opacity = params.waterOpacity;
            }
        });

        // Shadow Distance (frustum size)
        folder.addBinding(this.game, 'shadowDistance', { min: 50, max: 400, step: 10, label: 'Shadow Distance' }).on('change', () => {
            const d = this.game.shadowDistance;
            const sun = this.game.sunLight;
            if (sun) {
                sun.shadow.camera.left = -d;
                sun.shadow.camera.right = d;
                sun.shadow.camera.top = d;
                sun.shadow.camera.bottom = -d;
                sun.shadow.camera.updateProjectionMatrix();
            }
        });

        folder.addButton({ title: 'Regenerate' }).on('click', () => {
            this.regeneratePlanet();
        });

        const resFolder = folder.addFolder({ title: 'Resolution' });
        const meshResParams = { resolution: 500 };
        resFolder.addBinding(meshResParams, 'resolution', {
            label: '3D Mesh',
            min: 32,
            max: 1000,
            step: 16
        }).on('change', (ev) => {
            this.game.planet.meshResolution = ev.value;
            if (this.autoRegenerate) this.regeneratePlanet();
        });

        // Camera Controls (System 4.0)
        const cameraFolder = this.pane.addFolder({ title: 'Camera', expanded: false });
        cameraFolder.addBinding(this.game.cameraControls.config, 'minDistance', {
            label: 'Min Distance',
            min: 0,
            max: 10
        });
        cameraFolder.addBinding(this.game.cameraControls.config, 'maxDistance', {
            label: 'Max Distance',
            min: 100,
            max: 1000
        }).on('change', (ev) => {
            // Ensure maxDistance <= starDistance * 0.6
            const maxAllowed = this.game.starDistance * 0.6;
            if (ev.value > maxAllowed) {
                this.game.cameraControls.config.maxDistance = maxAllowed;
                ev.last = false; // Force refresh
            }
        });

        // Zoom Controls

        cameraFolder.addBinding(this.game.cameraControls.config, 'zoomInImpulse', {
            label: 'Zoom In Speed',
            min: 0.01,
            max: 0.3
        });
        cameraFolder.addBinding(this.game.cameraControls.config, 'zoomOutImpulse', {
            label: 'Zoom Out Speed',
            min: 0.01,
            max: 0.3
        });

        // Orbit Behavior (RMB)
        const orbitFolder = cameraFolder.addFolder({ title: 'RMB Orbit' });
        orbitFolder.addBinding(this.game.cameraControls.config, 'orbitAlignmentSpeed', {
            label: 'Alignment (Roll)',
            min: 0.05,
            max: 1.0
        });
        orbitFolder.addBinding(this.game.cameraControls.config, 'orbitCenteringSpeed', {
            label: 'Centering (LookAt)',
            min: 0,
            max: 0.1
        });


        cameraFolder.addBinding(this.game, 'starDistance', {
            label: 'Star Distance',
            min: 100,
            max: 1000
        }).on('change', (ev) => {
            // Ensure maxDistance doesn't exceed 60% of star distance
            const maxAllowed = ev.value * 0.6;
            if (this.game.cameraControls.config.maxDistance > maxAllowed) {
                this.game.cameraControls.config.maxDistance = maxAllowed;
            }
        });


        // Terrain Color Thresholds
        const colorFolder = folder.addFolder({ title: 'Color Thresholds' });
        colorFolder.addBinding(params, 'heightLowest', { min: -5, max: 0, label: 'Lowest H' }).on('change', () => { if (this.autoRegenerate) this.regeneratePlanet(); });
        colorFolder.addBinding(params, 'heightWater', { min: -2, max: 2, label: 'Water H' }).on('change', () => { if (this.autoRegenerate) this.regeneratePlanet(); });
        colorFolder.addBinding(params, 'heightMid', { min: 0, max: 5, label: 'Mid H' }).on('change', () => { if (this.autoRegenerate) this.regeneratePlanet(); });
        colorFolder.addBinding(params, 'heightPeak', { min: 2, max: 10, label: 'Peak H' }).on('change', () => { if (this.autoRegenerate) this.regeneratePlanet(); });

        // === NORMAL MAP INTENSITY ===
        const normalFolder = folder.addFolder({ title: 'Normal Maps' });

        // Terrain (Sand) Normal Scale
        const normalParams = {
            terrainNormal: 0.5,  // Original value
            rockNormal: 1.0     // Original value 
        };

        normalFolder.addBinding(normalParams, 'terrainNormal', {
            min: 0.1, max: 5.0, label: 'Terrain Normal'
        }).on('change', (ev) => {
            if (this.game.planet.mesh && this.game.planet.mesh.material) {
                this.game.planet.mesh.material.normalScale.set(ev.value, ev.value);
            }
        });

        normalFolder.addBinding(normalParams, 'rockNormal', {
            min: 0.1, max: 5.0, label: 'Rock Normal'
        }).on('change', (ev) => {
            if (this.game.rockSystem && this.game.rockSystem.materials) {
                this.game.rockSystem.materials.forEach(mat => {
                    mat.normalScale.set(ev.value, ev.value);
                });
                this.game.rockSystem.textureConfig.normalScale = ev.value;
            }
        });

        // Advanced Terrain
        const advFolder = this.pane.addFolder({ title: 'Advanced Terrain', expanded: false });

        advFolder.addBinding(params, 'noiseType', {
            label: 'Noise Type',
            options: {
                'Standard': 'standard',
                'Ridged': 'ridged',
                'Billow': 'billow'
            }
        }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });

        const warpFolder = advFolder.addFolder({ title: 'Domain Warp' });
        warpFolder.addBinding(params, 'domainWarpStrength', { min: 0, max: 2.0, label: 'Strength' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
        warpFolder.addBinding(params, 'domainWarpOctaves', { min: 1, max: 4, step: 1, label: 'Octaves' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
        warpFolder.addBinding(params, 'domainWarpScale', { min: 0.1, max: 3.0, label: 'Scale' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });

        const layersFolder = advFolder.addFolder({ title: 'Noise Layers' });
        layersFolder.addBinding(params, 'continentScale', { min: 0.1, max: 2.0, label: 'Continent Scale' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
        layersFolder.addBinding(params, 'continentStrength', { min: 0, max: 3.0, label: 'Continent Str' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
        layersFolder.addBinding(params, 'mountainScale', { min: 0.1, max: 3.0, label: 'Mountain Scale' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
        layersFolder.addBinding(params, 'mountainStrength', { min: 0, max: 2.0, label: 'Mountain Str' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
        layersFolder.addBinding(params, 'detailScale', { min: 0.5, max: 5.0, label: 'Detail Scale' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
        layersFolder.addBinding(params, 'detailStrength', { min: 0, max: 1.0, label: 'Detail Str' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });

        advFolder.addBinding(params, 'ridgePower', { min: 1.0, max: 3.0, label: 'Ridge Power' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });

        const envFolder = advFolder.addFolder({ title: 'Environment' });
        envFolder.addBinding(params, 'moistureScale', { min: 0.1, max: 3.0, label: 'Moisture Scale' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
        envFolder.addBinding(params, 'temperatureScale', { min: 0.1, max: 3.0, label: 'Temp Scale' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
        envFolder.addBinding(params, 'erosionStrength', { min: 0, max: 1.0, label: 'Erosion' }).on('change', () => {
            if (this.autoRegenerate) this.regeneratePlanet();
        });
    }

    setupUnitControls() {
        const unitFolder = this.pane.addFolder({ title: 'Unit & Vision', expanded: false });
        unitFolder.addBinding(this.game.unitParams, 'speed', { min: 1, max: 20 });
        unitFolder.addBinding(this.game.unitParams, 'turnSpeed', { min: 0.1, max: 5.0 });
        unitFolder.addBinding(this.game.unitParams, 'groundOffset', { min: -5.0, max: 10.0, label: 'Hover Height' });
        unitFolder.addBinding(this.game.unitParams, 'smoothingRadius', { min: 0.5, max: 10.0, label: 'Normal Smoothing' });
        unitFolder.addBinding(this.game.fogOfWar, 'currentVisionRadius', {
            min: 10, max: 100, label: 'Vision Radius'
        }).on('change', (ev) => {
            this.game.fogOfWar.setVisionRadius(ev.value);
        });

        // Planet Star Count Control (THREE.Points)
        const starParams = { count: 30000 };
        unitFolder.addBinding(starParams, 'count', {
            min: 5000, max: 100000, step: 5000, label: 'Planet Stars'
        }).on('change', (ev) => {
            // Remove old starField
            if (this.game.planet.starField) {
                this.game.scene.remove(this.game.planet.starField);
                this.game.planet.starField.geometry.dispose();
                this.game.planet.starField.material.dispose();
            }
            // Create new starField with updated count
            this.game.planet.starField = this.game.planet.createStarField(ev.value);
            this.game.scene.add(this.game.planet.starField);
            console.log(`Planet stars: ${ev.value}`);
        });

        // Planet Star Size Control
        const starSizeParams = { size: 0.5 };
        unitFolder.addBinding(starSizeParams, 'size', {
            min: 0.5, max: 8.0, step: 0.1, label: 'Star Size'
        }).on('change', (ev) => {
            if (this.game.planet.starField && this.game.planet.starField.material.uniforms) {
                this.game.planet.starField.material.uniforms.uStarSize.value = ev.value;
            }
        });
        // Apply initial star size on startup
        if (this.game.planet.starField && this.game.planet.starField.material.uniforms) {
            this.game.planet.starField.material.uniforms.uStarSize.value = starSizeParams.size;
        }
        const fowResParams = { resolution: 512 };
        unitFolder.addBinding(fowResParams, 'resolution', {
            label: 'FOW Resolution',
            options: {
                '256': 256,
                '512': 512,
                '1024': 1024,
                '2048': 2048,
                '4096': 4096,
                '8192': 8192
            }
        }).on('change', (ev) => {
            this.game.fogOfWar.setResolution(ev.value);
        });
        // Apply initial FOW resolution on startup
        this.game.fogOfWar.setResolution(fowResParams.resolution);

        // FOW Blur Control
        const fowBlurParams = { blur: 0.3 };
        unitFolder.addBinding(fowBlurParams, 'blur', {
            min: 0.0, max: 0.8, step: 0.05, label: 'FOW Edge Blur'
        }).on('change', (ev) => {
            if (this.game.fogOfWar && this.game.fogOfWar.brushMaterial) {
                // Store blur value for future brushes
                this.game.fogOfWar.blurAmount = ev.value;
            }
        });
        // Apply initial blur on startup
        if (this.game.fogOfWar) {
            this.game.fogOfWar.blurAmount = fowBlurParams.blur;
        }

        // FOW Map Smoothing (Shader based)
        const fowSmoothParams = { smoothing: 0.0 };
        unitFolder.addBinding(fowSmoothParams, 'smoothing', {
            min: 0.0, max: 2.0, step: 0.1, label: 'FOW Smoothing'
        }).on('change', (ev) => {
            if (this.game.planet.mesh.material.materialShader) {
                this.game.planet.mesh.material.materialShader.uniforms.uFowSmoothing.value = ev.value;
            }
        });



        const debugParams = {
            showTexture: false
        };

        unitFolder.addBinding(debugParams, 'showTexture', {
            label: 'Show Texture Map'
        }).on('change', (ev) => {
            this.game.textureDebugger.enabled = ev.value;
        });

        const params = {
            uvScaleX: 1.0,
            uvScaleY: 1.0,
            uvOffsetX: 0.0,
            uvOffsetY: 0.0,
            debugMode: 0,
            hiddenColor: { r: 0, g: 0, b: 0 }
        };

        unitFolder.addBinding(params, 'uvScaleX', { min: 0.1, max: 5.0 }).on('change', (ev) => {
            if (this.game.planet.mesh.material.materialShader) {
                this.game.planet.mesh.material.materialShader.uniforms.uUVScale.value.x = ev.value;
            }
        });
        unitFolder.addBinding(params, 'uvScaleY', { min: 0.1, max: 5.0 }).on('change', (ev) => {
            if (this.game.planet.mesh.material.materialShader) {
                this.game.planet.mesh.material.materialShader.uniforms.uUVScale.value.y = ev.value;
            }
        });
        unitFolder.addBinding(params, 'uvOffsetX', { min: -1.0, max: 1.0 }).on('change', (ev) => {
            if (this.game.planet.mesh.material.materialShader) {
                this.game.planet.mesh.material.materialShader.uniforms.uUVOffset.value.x = ev.value;
            }
        });
        unitFolder.addBinding(params, 'uvOffsetY', { min: -1.0, max: 1.0 }).on('change', (ev) => {
            if (this.game.planet.mesh.material.materialShader) {
                this.game.planet.mesh.material.materialShader.uniforms.uUVOffset.value.y = ev.value;
            }
        });

        unitFolder.addBinding(params, 'debugMode', {
            options: { Normal: 0, UV: 1, Texture: 2 }
        }).on('change', (ev) => {
            if (this.game.planet.mesh.material.materialShader) {
                this.game.planet.mesh.material.materialShader.uniforms.uDebugMode.value = ev.value;
            }
        });

        unitFolder.addBinding(params, 'hiddenColor').on('change', (ev) => {
            if (this.game.planet.mesh.material.materialShader) {
                this.game.planet.mesh.material.materialShader.uniforms.uFowColor.value.setRGB(ev.value.r, ev.value.g, ev.value.b);
            }
        });
    }

    updateShadowsState(enabled) {
        if (this.game.renderer) {
            this.game.renderer.shadowMap.enabled = enabled;
            this.game.renderer.shadowMap.autoUpdate = enabled;
            this.game.renderer.shadowMap.needsUpdate = true; // Force immediate update

            // Force material update
            this.game.scene.traverse((obj) => {
                if (obj.material) obj.material.needsUpdate = true;
            });

            if (this.game.sunLight) {
                this.game.sunLight.castShadow = enabled;
                if (enabled) {
                    this.game.sunLight.shadow.camera.updateProjectionMatrix();
                }
            }
        }
    }

    regeneratePlanet() {
        this.game.planet.regenerate();
        this.game.unit.snapToSurface();
    }
}
