import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Planet } from '../World/Planet.js';
import { SphericalCameraController4 } from '../Camera/SphericalCameraController4.js';
import { Unit } from '../Entities/Unit.js';
import { DebugPanel } from '../UI/DebugPanel.js';
import { Input } from './Input.js';
import { FogOfWar } from '../World/FogOfWar.js';
import { TextureDebugger } from '../UI/TextureDebugger.js';

import { CameraDebug } from '../UI/CameraDebug.js';
import { InteractionManager } from './InteractionManager.js';
import { RockSystem } from '../World/RockSystem.js';
import { RockDebug } from '../UI/RockDebug.js';
import { SphericalNavMesh } from '../Navigation/SphericalNavMesh.js';
import { NavMeshDebug } from '../UI/NavMeshDebug.js';
import { RockCollisionSystem } from '../Physics/RockCollisionSystem.js';
import { AudioManager } from './AudioManager.js';
import { PathPlanner } from '../Navigation/PathPlanner.js';
import { SimLoop } from '../SimCore/runtime/SimLoop.js';
import { nextEntityId, peekEntityId, setEntityIdCounter } from '../SimCore/runtime/IdGenerator.js';
import { rngNext, getGlobalRNG } from '../SimCore/runtime/SeededRNG.js';
import { globalCommandQueue, CommandType } from '../SimCore/runtime/CommandQueue.js';
import { initializeTransport, SupabaseTransport } from '../SimCore/transport/index.js';
import { WebSocketTransport } from '../SimCore/transport/WebSocketTransport.js';
import { SaveManager, MemoryStorageAdapter, LocalStorageAdapter, SupabaseStorageAdapter } from '../SimCore/persistence/index.js';
import { serializeState, hashState } from '../SimCore/runtime/StateSurface.js';
import { SessionManager } from '../SimCore/multiplayer/SessionManager.js';
import { SnapshotBuffer } from '../SimCore/net/SnapshotBuffer.js';

import { WaypointDebugOverlay } from '../UI/WaypointDebugOverlay.js';
import { globalCommandDebugOverlay } from '../UI/CommandDebugOverlay.js';
import { initNetworkDebugPanel } from '../UI/NetworkDebugPanel.js';
import { SeatKeypadOverlay } from '../UI/SeatKeypadOverlay.js';
import { JoinOverlay } from '../UI/JoinOverlay.js';
import { MultiplayerHUD } from '../UI/MultiplayerHUD.js';
import { AdaptivePerformance } from './AdaptivePerformance.js';

export class Game {
    constructor() {
        // R012: Check dev mode early for HUD
        const urlParams = new URLSearchParams(window.location.search);
        const hash = window.location.hash;
        this._isDevMode = urlParams.has('dev') || hash.includes('dev=1');

        // Debug console toggle state (default: hidden)
        this._debugConsoleVisible = false;

        // Create unified NetworkDebugPanel early (so transport init can update it)
        if (this._isDevMode) {
            this.networkDebugPanel = initNetworkDebugPanel(this);
            // Panel starts hidden; user toggles with the console button
        }

        // R007/R012: Transport Initialization
        const netMode = urlParams.get('net');
        this._netMode = netMode; // Store for MultiplayerHUD visibility check

        if (netMode === 'supabase') {
            const configObj = window.ASTEROBIA_CONFIG;
            const config = (configObj && configObj.supabase) ? configObj.supabase : null;
            const supabase = window.supabase; // from CDN

            // R012: Validate config was loaded and has non-placeholder values
            const configLoaded = (configObj && configObj._loaded) === true;
            const hasPlaceholders = (config && config.url && config.url.includes('YOUR_PROJECT_ID')) ||
                                    (config && config.key && config.key.includes('YOUR_ANON_KEY')) ||
                                    (config && config.url && config.url.includes('xyzcompany'));

            if (!configLoaded || !config || !config.url || !config.key) {
                console.warn('[Game] Supabase config missing. Falling back to Local.');
                this._transport = initializeTransport();
                this._updateNetStatus('LOCAL', { config: 'MISSING', auth: 'N/A', rt: 'N/A' });
            } else if (hasPlaceholders) {
                console.warn('[Game] Supabase config has placeholder values. Edit public/config.js');
                this._transport = initializeTransport();
                this._updateNetStatus('LOCAL', { config: 'PLACEHOLDER', auth: 'N/A', rt: 'N/A' });
            } else if (!supabase) {
                console.warn('[Game] Supabase SDK not loaded from CDN.');
                this._transport = initializeTransport();
                this._updateNetStatus('LOCAL', { config: 'SDK MISSING', auth: 'N/A', rt: 'N/A' });
            } else {
                // R012 Security Gate: Validate Key Role (must be "anon")
                let isValidKey = false;
                let keyRole = 'unknown';
                try {
                    const parts = config.key.split('.');
                    if (parts.length === 3) {
                        const payload = JSON.parse(atob(parts[1]));
                        keyRole = payload.role || 'unknown';
                        if (keyRole === 'anon') {
                            isValidKey = true;
                        } else {
                            console.error('[Game] SECURITY: Key role is "' + keyRole + '" (expected "anon")');
                        }
                    }
                } catch (e) {
                    console.error('[Game] Config key is not a valid JWT.');
                }

                if (isValidKey) {
                    console.log('[Game] Initializing Supabase Transport...');
                    const client = supabase.createClient(config.url, config.key);
                    this._supabaseClient = client; // Store for persistence adapter

                    const transport = new SupabaseTransport({
                        supabaseClient: client,
                        room: 'r012-echo',
                        throttleMs: 100
                    });
                    this._transport = initializeTransport(transport);
                    this._supabaseTransport = transport; // Store ref for status polling

                    // Initial status
                    this._updateNetStatus('SUPABASE', { config: 'OK', auth: 'ANON OK', rt: 'CONNECTING...' });

                    // R012: Poll transport state and update HUD
                    this._startRealtimeStatusPolling();

                    // R012: Auto sign-in anonymously for persistence
                    this._initSupabaseAuth(client);
                } else {
                    console.warn('[Game] Invalid/Unsafe key. Falling back to Local.');
                    this._transport = initializeTransport();
                    const keyMsg = keyRole === 'service_role' ? 'SERVICE_ROLE!' : 'KEY INVALID';
                    this._updateNetStatus('LOCAL', { config: keyMsg, auth: 'FAIL', rt: 'N/A' });
                }
            }
        } else if (netMode === 'ws') {
            // R013-NB1: WebSocket direct-connect mode
            // Default: same port as page (8081). Override: ?wsPort= or ?wsUrl=
            const wsPort = urlParams.get('wsPort') || window.location.port || '8081';
            const wsUrl = urlParams.get('wsUrl') || `ws://localhost:${wsPort}`;
            console.log('[Game] Initializing WebSocket Transport to', wsUrl);

            const wsTransport = new WebSocketTransport({ url: wsUrl });
            this._transport = initializeTransport(wsTransport);
            this._wsTransport = wsTransport; // Store ref for status polling

            this._updateNetStatus('WS', { config: 'DIRECT', auth: 'N/A', rt: 'CONNECTING...' });
        } else {
            // Default: Local Transport
            this._transport = initializeTransport();
            if (this._isDevMode) {
                this._updateNetStatus('LOCAL', { config: 'N/A', auth: 'N/A', rt: 'N/A' });
            }
        }

        // ... (existing)
        this.debugOverlay = new WaypointDebugOverlay(this);
        this.commandDebugOverlay = globalCommandDebugOverlay; // R006: Command debug overlay
        window.game = this; // Expose for UI interactions

        // R001: Fixed-timestep simulation loop (50ms tick)
        this.simLoop = new SimLoop({ fixedDtMs: 50 });
        this.simLoop.onSimTick = (dt, tick) => this.simTick(dt, tick);
        // R008: Hook render callback for interpolation
        this.simLoop.onRender = (alpha) => this._applyInterpolatedRender(alpha);

        // R013: State surface for multiplayer snapshot serialization
        // Wraps StateSurface functions with Game context for SessionManager
        this.stateSurface = {
            /**
             * Serialize current game state for multiplayer snapshot.
             * Returns plain JSON-safe object (no circular refs, no Three.js objects).
             * @returns {Object} Serialized state
             */
            serialize: () => {
                return serializeState(this);
            },

            /**
             * Apply a received snapshot to restore game state.
             * Used by guests when joining a session.
             * @param {Object} snapshot - Serialized state from host
             */
            deserialize: (snapshot) => {
                if (!snapshot) return;

                // Restore tick count
                if (typeof snapshot.tickCount === 'number' && this.simLoop) {
                    this.simLoop.tickCount = snapshot.tickCount;
                }

                // Restore unit states
                if (snapshot.units && Array.isArray(snapshot.units)) {
                    this._restoreUnitsFromSave(snapshot.units);
                }
            }
        };

        // R013 M07: Expose command queue on game instance for cross-module access
        this.commandQueue = globalCommandQueue;

        // R013: Multiplayer session manager
        this.sessionManager = new SessionManager(this);
        // R013: Wire up transport for multiplayer channels
        if (this._supabaseTransport) {
            this.sessionManager.setTransport(this._supabaseTransport);
        } else if (this._wsTransport) {
            this.sessionManager.setTransport(this._wsTransport);
        }

        // R013: Multiplayer join UI (when net=supabase or net=ws)
        // R013: Multiplayer status HUD (created but hidden until overlay closes)
        this.multiplayerHUD = null;
        if (netMode === 'supabase' || netMode === 'ws') {
            this.multiplayerHUD = new MultiplayerHUD(this);
            this.joinOverlay = new JoinOverlay();
            this.joinOverlay.onHost = async (roomCode, username) => {
                if (!this.sessionManager.transport) {
                    this.joinOverlay.showError('No network transport available. Check Supabase config.');
                    return;
                }
                this.playerName = username || 'Host';
                this.clientId = 'room-' + roomCode;
                try {
                    await this.sessionManager.hostGame('Room ' + roomCode);
                    // Phase 2A: Send SPAWN_MANIFEST to server (idempotent, gated by _manifestSent)
                    this._sendSpawnManifest();
                    // Don't hide overlay - host stays on screen showing room code
                    // Host clicks START GAME to dismiss (handled by onStart)
                } catch (err) {
                    this.joinOverlay.showError('Failed to host: ' + err.message);
                }
            };
            this.joinOverlay.onStart = () => {
                // Host clicked START GAME - overlay hides itself, refresh tabs
                this._showMultiplayerHUD();
                this.generateUnitTabs();
                window.showModeSelection?.();
            };
            this.joinOverlay.onGuest = async (roomCode, username) => {
                if (!this.sessionManager.transport) {
                    this.joinOverlay.showError('No network transport available. Check Supabase config.');
                    return;
                }
                this.playerName = username || 'Guest';
                const hostId = 'room-' + roomCode;
                try {
                    await this.sessionManager.joinGame(hostId);
                    this.joinOverlay.hide();
                    // Show multiplayer HUD now that game is active
                    this._showMultiplayerHUD();

                    // R013: Spawn a unit for the Guest and focus camera on it
                    const mySlot = this.sessionManager.getMySlot();
                    const guestUnit = this._spawnUnitForPlayer(mySlot);
                    if (guestUnit) {
                        // Select the unit (seats us + flies camera to it)
                        this.selectUnit(guestUnit);
                        // Defense-in-depth: explicitly fly camera to guest's unit
                        // selectUnit→zoomCameraToPath should handle this, but ensure
                        // the camera ends up above the guest's unit even if path zoom
                        // logic is bypassed for any reason.
                        if (this.cameraControls && this.cameraControls.flyTo) {
                            this.cameraControls.flyTo(guestUnit);
                        }
                        if (this._isDevMode) {
                            console.log(`[Game] Guest spawned and selected unit ${guestUnit.id} (slot ${mySlot})`);
                        }
                    }

                    this.generateUnitTabs(); // Refresh tabs after joining
                    window.showModeSelection?.();
                } catch (err) {
                    this.joinOverlay.showError('Failed to join: ' + err.message);
                }
            };
            this.joinOverlay.onSinglePlayer = () => {
                // Single player - no network, no HUD, just play
                this.generateUnitTabs();
                window.showModeSelection?.();
            };
            this.joinOverlay.show();
        }

        // M07 GAP-0: Seat keypad overlay for PIN-protected units
        this.seatKeypadOverlay = new SeatKeypadOverlay(this);

        // M07: Callback from SessionManager when seat is granted
        // Called after SEAT_ACK is received - triggers unit selection
        this.onSeatGranted = (targetUnitId, controllerSlot) => {
            // Hide keypad if it was showing for this unit
            if (this.seatKeypadOverlay &&
                this.seatKeypadOverlay.isVisible &&
                this.seatKeypadOverlay.targetUnitId === targetUnitId) {
                this.seatKeypadOverlay.hide();
            }

            // If this grant is for us, select the unit (skip if already selected to prevent loop)
            const mySlot = this.sessionManager?.state?.mySlot;
            if (controllerSlot === mySlot) {
                const unit = this.units.find(u => u && u.id === targetUnitId);
                if (unit && this.selectedUnit !== unit) {
                    // Now we have the seat - select the unit
                    this.selectUnit(unit); // camera flies to unit on seat grant
                    if (this._isDevMode) {
                        console.log(`[Game] Seat granted: unit ${targetUnitId} -> selecting`);
                    }
                }
            }

            // Refresh tabs for all clients (seat state changed)
            this.generateUnitTabs();
        };

        // Callback when a seat is released (unit freed)
        this.onSeatReleased = (targetUnitId, releasedBySlot) => {
            // Refresh tabs for all clients
            this.generateUnitTabs();
        };

        // Callback when connection state changes (HOST/GUEST/OFFLINE)
        // Regenerate tabs so Guest starts with correct (empty) tab set
        this.sessionManager.onConnectionStateChanged = (state) => {
            // R013: Host-side guest unit spawning
            // When host detects a new player, spawn a unit for them
            if (state === 'HOSTING' && this.sessionManager.isHost()) {
                const players = this.sessionManager.getPlayers();
                for (const player of players) {
                    // Skip host (slot 0) - host already has units
                    if (player.slot === 0) continue;
                    // Check if this player already has a unit (avoid duplicate spawns)
                    const hasUnit = this.units.some(u => u && u.ownerSlot === player.slot);
                    if (!hasUnit) {
                        this._spawnUnitForPlayer(player.slot);
                        if (this._isDevMode) {
                            console.log(`[Game] Host spawned unit for guest slot ${player.slot} (${player.displayName})`);
                        }
                    }
                }
            }

            this.generateUnitTabs();
            // Update multiplayer HUD with latest state
            if (this.multiplayerHUD) {
                this.multiplayerHUD.update();
            }
            // Update player count on overlay when players join/leave
            if (this.joinOverlay && this.joinOverlay.isVisible) {
                const playerCount = this.sessionManager.getPlayers().length;
                this.joinOverlay.updatePlayerCount(playerCount);
            }
        };

        /**
         * R013 M07: Command execution gate for Slice 1 transport testing.
         * Dynamic based on role:
         * - OFFLINE/HOST: true (they run the simulation, must execute)
         * - GUEST Slice 1: false (queue accumulates for transport testing)
         * - GUEST Slice 2+: true (actual gameplay)
         * @type {boolean}
         */
        this._guestExecutionEnabled = true; // Slice 2: enabled

        // Phase 2A: Mirror mode state
        // Activated when first SERVER_SNAPSHOT is received. Deactivated on disconnect.
        this._mirrorMode = false;
        this._snapshotBuffer = new SnapshotBuffer(); // Ring buffer for server snapshot interpolation

        // Phase 2A: MOVE_INPUT latching (captures key presses between 20Hz sends)
        this._latchedKeys = { forward: false, backward: false, left: false, right: false };
        this._lastMoveInputSendMs = 0;
        this._MOVE_INPUT_INTERVAL_MS = 50; // 20Hz send rate
        this._manifestSent = false; // Phase 2A: SPAWN_MANIFEST sent exactly once

        // R011: Dev-only save/load hotkeys (Ctrl+Alt+S / Ctrl+Alt+L)
        this._setupDevSaveLoad();

        this.container = document.body;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(0.7);
        this.container.appendChild(this.renderer.domElement);

        // Adaptive Performance Monitor (auto-adjusts quality based on FPS)
        this.adaptivePerf = new AdaptivePerformance(this);

        // R006-fix: Enable canvas to receive keyboard focus
        this._setupCanvasFocus();

        // Scene
        this.scene = new THREE.Scene();

        // Starfield
        this.starDistance = 500; // Distance to stars from origin

        const starGeometry = new THREE.BufferGeometry();
        const starCount = 10000;
        const positions = new Float32Array(starCount * 3);

        // visual-only randomness, nondeterministic allowed (starfield cosmetics)
        for (let i = 0; i < starCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = this.starDistance;

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);
        }

        starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5 });
        this.stars = new THREE.Points(starGeometry, starMaterial);
        this.scene.add(this.stars);

        // Log star sizing info with adjustment instructions
        if (this._isDevMode) {
            console.log("=== STAR PARAMETERS ===");
            console.log("Location: Planet.js water shader (~line 97-115)");
            console.log("Grid Size: 100x100 (starUV * 100.0)");
            console.log("Star Density: 15% (cellHash > 0.85) - lower = more stars");
            console.log("Star Size: 0.08 - 0.13");
            console.log("");
            console.log("TO ADJUST DENSITY: Edit 'cellHash > 0.85' value in Planet.js");
            console.log("  0.50 = 50% dense, 0.85 = 15% dense, 0.95 = 5% sparse");
        }

        // Camera
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

        // LIGHTING SETUP
        // Increased ambient light for better visibility in shadow (was 0.15)
        // Increased ambient light for better visibility in shadow (was 0.15)
        this.ambientLight = new THREE.AmbientLight(0x405060, 0.9);
        this.scene.add(this.ambientLight);

        // Hemisphere Light: Subtle sky/ground color difference
        const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444422, 0.2);
        this.scene.add(hemiLight);

        // Main Sun Light - slightly brighter (was 2.0)
        const sunLight = new THREE.DirectionalLight(0xfffaf0, 2.3); // Warm white
        sunLight.position.set(400, 0, 0); // Pure side = exact 50/50 light/shadow
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 4096;
        sunLight.shadow.mapSize.height = 4096;
        sunLight.shadow.camera.near = 50;
        sunLight.shadow.camera.far = 600;
        // Shadow frustum size - adjustable via debug panel
        this.shadowDistance = 150;
        sunLight.shadow.camera.left = -this.shadowDistance;
        sunLight.shadow.camera.right = this.shadowDistance;
        sunLight.shadow.camera.top = this.shadowDistance;
        sunLight.shadow.camera.bottom = -this.shadowDistance;
        sunLight.shadow.bias = -0.0001;
        sunLight.shadow.camera.updateProjectionMatrix(); // CRITICAL: Apply shadow camera settings
        this.sunLight = sunLight;
        this.scene.add(sunLight);
        // CRITICAL: Add sunLight.target to scene for shadows to work
        sunLight.target.position.set(0, 0, 0);
        this.scene.add(sunLight.target);

        // Core Systems
        this.input = new Input();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Asset Loading Manager
        this.loadingManager = new THREE.LoadingManager();
        this.assetsLoaded = false;

        this.loadingManager.onLoad = () => {
            console.log('[Game] All assets loaded!');
            this.assetsLoaded = true;
        };

        this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
            console.log(`[Game] Loading file: ${url}.\nLoaded ${itemsLoaded} of ${itemsTotal} files.`);
        };

        this.loadingManager.onError = (url) => {
            console.error('[Game] There was an error loading ' + url);
            // Don't let a single failed asset block the game forever.
            // If most assets are loaded, consider it loaded enough.
            if (this.loadingManager.itemsLoaded >= this.loadingManager.itemsTotal - 1) {
                console.warn('[Game] Marking assets as loaded despite error (most assets ready)');
                this.assetsLoaded = true;
            }
        };

        // World
        this.planet = new Planet(this.scene, this.loadingManager);
        this.scene.add(this.planet.mesh);
        this.scene.add(this.planet.waterMesh);
        this.scene.add(this.planet.starField);

        // Camera Controls (System 4.0 - Clean Rebuild)
        this.cameraControls = new SphericalCameraController4(this.camera, this.renderer.domElement, this.planet);
        this.cameraControls.game = this; // Reference for unit collision

        // Audio Manager
        this.audioManager = new AudioManager();

        // Entities
        this.units = [];
        this.selectedUnit = null;
        this.unitParams = {
            speed: 5.0,
            turnSpeed: 2.0,
            groundOffset: 0.22,
            smoothingRadius: 0.5 // Radius for terrain normal averaging
        };
        this.loadUnits();

        // Fog of War (shader-based, spherical)
        this.fogOfWar = new FogOfWar(this.renderer, this.planet.terrain.params.radius);

        // Rocks on terrain (System V2)
        this.rockSystem = new RockSystem(this, this.planet); // Rocks are procedural, no external assets effectively
        this.rockSystem.generateRocks(); // Initial generation 
        this.planet.rockSystem = this.rockSystem; // Make accessible to Units

        // Rock Collision System (Broadphase + Slide)
        this.rockCollision = new RockCollisionSystem(this.planet, this.rockSystem);
        this.planet.rockCollision = this.rockCollision; // Make accessible to Units

        // Navigation Mesh (Spherical PathFinding)
        this.navMesh = new SphericalNavMesh(this.planet.terrain, this.rockSystem);
        this.navMesh.generate();
        this.scene.add(this.navMesh.debugMesh);
        
        // Path Planner (Hierarchical: Global A* + Local Refinement)
        this.pathPlanner = new PathPlanner(this.navMesh, this.rockSystem, this.planet.terrain);
        const sphereGeo = new THREE.SphereGeometry(15, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.2 });
        this.visionHelper = new THREE.Mesh(sphereGeo, sphereMat);
        this.visionHelper.visible = false; // Hidden by default
        if (this._isDevMode) console.log("Vision Helper is hidden. To enable: game.visionHelper.visible = true");
        this.scene.add(this.visionHelper);

        // UI
        this.unit = new Unit(this.planet, nextEntityId()); // Dummy for initial DebugPanel (R003: deterministic ID)
        this.debugPanel = new DebugPanel(this);

        // Refinement: Rock Debugger
        this.rockDebug = new RockDebug(this);

        // Texture Debugger
        this.textureDebugger = new TextureDebugger(this.renderer, this.fogOfWar.exploredTarget.texture);

        // Camera Debug Overlay
        this.cameraDebug = new CameraDebug(this);

        // Navigation Mesh Debug Panel
        this.navMeshDebug = new NavMeshDebug(this);

        // Bindings
        this.onWindowResize = this.onWindowResize.bind(this);
        // this.onMouseDown... etc removed, handled by InteractionManager
        this.animate = this.animate.bind(this);

        window.addEventListener('resize', this.onWindowResize);

        // Path Drawing Visuals (hidden - using green waypoint curve instead)
        this.currentPath = [];
        this.pathGeometry = new THREE.BufferGeometry();
        this.pathMaterial = new THREE.LineBasicMaterial({ color: 0xffff00 });
        this.pathLine = new THREE.Line(this.pathGeometry, this.pathMaterial);
        this.pathLine.visible = false; // Hidden - we use the green tube now
        this.scene.add(this.pathLine);

        // Interaction Manager (System V3)
        this.interactionManager = new InteractionManager(this);

        // Audio Manager (Initialized above before loadUnits)

        // R013 M07: Dev-only evidence helper (no console.log dependency)
        if (this._isDevMode) {
            window.dumpNetEvidence = () => this._dumpNetEvidence();
        }

        // Debug Console Toggle Button (top-left corner)
        // Debug toggle button created later, only if DEV mode is selected
        // (see applyDevMode() called from Main.js)

        // Default: hide all debug consoles on startup
        this._hideAllDebugConsoles();

    } // End Constructor

    /**
     * Apply dev/game mode settings. Called from Main.js after user selects mode.
     * In GAME mode: hides all debug UI elements.
     * In DEV mode: creates debug toggle button and shows debug panels.
     * @param {boolean} isDev - true for DEV mode, false for GAME mode
     */
    applyDevMode(isDev) {
        this._isDevMode = isDev;
        if (isDev) {
            this._createDebugToggleButton();
            // Show visibility indicator in DEV mode
            const visEl = document.getElementById('visibility-indicator');
            if (visEl) visEl.style.display = '';
        } else {
            // GAME mode: hide all debug/dev UI
            this._hideAllDebugConsoles();
            // Hide visibility indicator
            const visEl = document.getElementById('visibility-indicator');
            if (visEl) visEl.style.display = 'none';
            // Hide version display
            const verEl = document.getElementById('version-display');
            if (verEl) verEl.style.display = 'none';
            // Hide sync HUD if it was already created
            const syncEl = document.getElementById('sync-hud');
            if (syncEl) syncEl.style.display = 'none';
            // Hide debug toggle button if it exists
            const toggleEl = document.getElementById('debug-console-toggle');
            if (toggleEl) toggleEl.style.display = 'none';
        }
    }

    /**
     * Create the debug console toggle button in the top-left corner.
     * Toggles visibility of ALL debug panels at once.
     * @private
     */
    _createDebugToggleButton() {
        const btn = document.createElement('button');
        btn.id = 'debug-console-toggle';
        btn.textContent = '\u{1F5A5}\uFE0F Console';
        btn.style.cssText = `
            position: fixed;
            top: 8px;
            left: 8px;
            background: rgba(0, 0, 0, 0.7);
            color: #aaa;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 4px 10px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            cursor: pointer;
            z-index: 10000;
            user-select: none;
            transition: background 0.15s, border-color 0.15s;
        `;
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(0, 0, 0, 0.9)';
            btn.style.borderColor = '#888';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = this._debugConsoleVisible
                ? 'rgba(0, 40, 0, 0.8)' : 'rgba(0, 0, 0, 0.7)';
            btn.style.borderColor = this._debugConsoleVisible ? '#0a0' : '#555';
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDebugConsoles();
        });
        document.body.appendChild(btn);
        this._debugToggleBtn = btn;
    }

    /**
     * Toggle ALL debug consoles on/off.
     * Controls: NetworkDebugPanel, Tweakpane DebugPanel, Stats.js,
     * WaypointDebugOverlay, CommandDebugOverlay, CameraDebug,
     * RockDebug, TextureDebugger, NavMeshDebug.
     */
    toggleDebugConsoles() {
        this._debugConsoleVisible = !this._debugConsoleVisible;
        const show = this._debugConsoleVisible;

        // Update toggle button text and style
        if (this._debugToggleBtn) {
            this._debugToggleBtn.textContent = show
                ? '\u{1F5A5}\uFE0F Console \u2713' : '\u{1F5A5}\uFE0F Console';
            this._debugToggleBtn.style.color = show ? '#0f0' : '#aaa';
            this._debugToggleBtn.style.borderColor = show ? '#0a0' : '#555';
            this._debugToggleBtn.style.background = show
                ? 'rgba(0, 40, 0, 0.8)' : 'rgba(0, 0, 0, 0.7)';
        }

        // 1. Unified NetworkDebugPanel (was DevHUD + NetworkDebugPanel)
        if (this.networkDebugPanel) {
            show ? this.networkDebugPanel.show() : this.networkDebugPanel.hide();
        }

        // 2. Tweakpane DebugPanel
        if (this.debugPanel && this.debugPanel.pane) {
            this.debugPanel.pane.hidden = !show;
        }

        // 3. Stats.js (FPS counter)
        if (this.debugPanel && this.debugPanel.stats && this.debugPanel.stats.dom) {
            this.debugPanel.stats.dom.style.display = show ? 'block' : 'none';
        }

        // 4. WaypointDebugOverlay
        if (this.debugOverlay) {
            show ? this.debugOverlay.show() : this.debugOverlay.hide();
        }

        // 5. CommandDebugOverlay
        if (this.commandDebugOverlay) {
            if (show) {
                this.commandDebugOverlay.show();
            } else {
                this.commandDebugOverlay.hide();
            }
        }

        // 6. CameraDebug (has a container div, no show/hide methods)
        if (this.cameraDebug && this.cameraDebug.container) {
            this.cameraDebug.container.style.display = show ? 'block' : 'none';
        }

        // 7. NavMeshDebug (Tweakpane-based)
        if (this.navMeshDebug && this.navMeshDebug.pane) {
            this.navMeshDebug.pane.hidden = !show;
        }

        // 8. R012 Dev HUD legacy DOM cleanup (if still in DOM from prior runs)
        const legacyHud = document.getElementById('r012-dev-hud');
        if (legacyHud) {
            legacyHud.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * Force-hide all debug consoles (used on startup for default-hidden state).
     * Does not toggle _debugConsoleVisible (it should already be false).
     * @private
     */
    _hideAllDebugConsoles() {
        // NetworkDebugPanel (already starts hidden via display:none)
        if (this.networkDebugPanel && this.networkDebugPanel.isVisible()) {
            this.networkDebugPanel.hide();
        }

        // Tweakpane DebugPanel
        if (this.debugPanel && this.debugPanel.pane) {
            this.debugPanel.pane.hidden = true;
        }

        // Stats.js
        if (this.debugPanel && this.debugPanel.stats && this.debugPanel.stats.dom) {
            this.debugPanel.stats.dom.style.display = 'none';
        }

        // WaypointDebugOverlay (starts visible by default)
        if (this.debugOverlay) {
            this.debugOverlay.hide();
        }

        // CommandDebugOverlay
        if (this.commandDebugOverlay) {
            this.commandDebugOverlay.hide();
        }

        // CameraDebug
        if (this.cameraDebug && this.cameraDebug.container) {
            this.cameraDebug.container.style.display = 'none';
        }

        // NavMeshDebug
        if (this.navMeshDebug && this.navMeshDebug.pane) {
            this.navMeshDebug.pane.hidden = true;
        }

        // Legacy R012 HUD
        const legacyHud = document.getElementById('r012-dev-hud');
        if (legacyHud) {
            legacyHud.style.display = 'none';
        }
    }

    /**
     * R013 M07: Dynamic command execution gate.
     * - OFFLINE/HOST: always true (they run the simulation)
     * - GUEST: controlled by _guestExecutionEnabled (Slice 1: false, Slice 2: true)
     * @returns {boolean}
     */
    get ENABLE_COMMAND_EXECUTION() {
        const role = this.sessionManager?.getRole?.() || 'OFFLINE';
        // OFFLINE and HOST always execute (they run the sim)
        if (role === 'OFFLINE' || role === 'HOST') {
            return true;
        }
        // GUEST: controlled by slice flag
        return this._guestExecutionEnabled;
    }

    /**
     * R013 M07: Dev-only evidence dump (no console.log dependency).
     * Call via window.dumpNetEvidence() in browser.
     * Uses getNetEvidence() for JSON-safe unit data (no circular refs).
     * @returns {Object} Evidence object for HU-TEST
     */
    _dumpNetEvidence() {
      try {
        // Use getNetEvidence() for JSON-safe data (no circular refs, no seatPinDigit)
        const netEvidence = this.sessionManager?.getNetEvidence?.() || {};

        // Summarize units with position (separate from netEvidence units)
        const unitSummary = (this.units || []).filter(u => u).map(u => ({
            id: u.id,
            ownerSlot: u.ownerSlot ?? 0,
            selectedBySlot: u.selectedBySlot ?? null,
            seatPolicy: u.seatPolicy ?? 'OPEN',
            // NOTE: seatPinDigit intentionally excluded (privacy)
            pos: u.position ? {
                x: Number(u.position.x).toFixed(2),
                y: Number(u.position.y).toFixed(2),
                z: Number(u.position.z).toFixed(2)
            } : null,
            pathPoints: u.waypointControlPoints?.length || 0
        }));

        // Build JSON-safe evidence object (no circular refs)
        const evidence = {
            tick: this.simLoop?.tickCount || 0,
            role: netEvidence.role || 'OFFLINE',
            mySlot: netEvidence.mySlot ?? 0,
            ENABLE_COMMAND_EXECUTION: this.ENABLE_COMMAND_EXECUTION,
            _guestExecutionEnabled: this._guestExecutionEnabled,
            queuePending: this.commandQueue?.pendingCount || 0,
            unitCount: this.units?.filter(u => u)?.length || 0,
            selectedUnitId: this.selectedUnit?.id || null,
            units: unitSummary,
            // Spread debug counters (primitives only)
            debugCounters: netEvidence.debugCounters || {},
            // Gating state
            batchSeqCounter: netEvidence.batchSeqCounter ?? 0,
            lastReceivedBatchSeq: netEvidence.lastReceivedBatchSeq ?? -1,
            inputBufferSize: netEvidence.inputBufferSize ?? 0
        };

        return evidence;
      } catch (err) {
        // Safety net: never throw from evidence dump
        return { error: err.message, tick: this.simLoop?.tickCount || 0 };
      }
    }

    /**
     * R013 M07: Get network evidence as clean, JSON-safe object.
     * CRITICAL: Returns ONLY primitives and simple arrays.
     * NEVER include: transport, supabase client, game ref, objects with methods.
     * Safe to call JSON.stringify() on the result.
     * @returns {Object} JSON-safe evidence object
     */
    getNetEvidence() {
      try {
        return {
            role: this.sessionManager?.state?.role || 'OFFLINE',
            mySlot: this.sessionManager?.state?.mySlot ?? -1,
            units: (this.units || []).map(u => u ? {
                id: u.id,
                ownerSlot: u.ownerSlot,
                selectedBySlot: u.selectedBySlot,
                seatPolicy: u.seatPolicy
                // NO seatPinDigit - privacy
                // NO references to game, supabase, transport
            } : null).filter(Boolean),
            selectedUnitId: this.selectedUnit?.id ?? null,
            debugCounters: this.sessionManager?._debugCounters ? { ...this.sessionManager._debugCounters } : {}
        };
      } catch (err) {
        return { error: err.message };
      }
    }

    // R013: Show the multiplayer status HUD (called when JoinOverlay hides)
    _showMultiplayerHUD() {
        if (this.multiplayerHUD && (this._netMode === 'supabase' || this._netMode === 'ws')) {
            this.multiplayerHUD.show();
        }
    }

    // R012: Update network status in unified NetworkDebugPanel
    _updateNetStatus(status, extraInfo = {}) {
        if (!this.networkDebugPanel) return;
        this.networkDebugPanel.setNetStatus(status, extraInfo);
    }

    // R013: Visible sync diagnostic overlay (DEV mode only)
    _updateSyncHUD(role, counters, tick) {
        if (!this._isDevMode) return;
        let el = document.getElementById('sync-hud');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sync-hud';
            el.style.cssText = 'position:fixed;top:30px;left:10px;background:rgba(0,0,0,0.7);color:#0f0;font-family:monospace;font-size:11px;padding:4px 8px;z-index:9999;pointer-events:none;border-radius:4px;line-height:1.4;';
            document.body.appendChild(el);
        }
        const sent = counters?.positionSyncSentCount || 0;
        const recv = counters?.positionSyncRecvCount || 0;
        const cmdSent = counters?.batchSentCount || 0;
        const cmdRecv = counters?.batchRecvCount || 0;
        el.textContent = `${role} t:${tick} pos:${sent}/${recv} cmd:${cmdSent}/${cmdRecv}`;
        el.style.color = (role === 'GUEST' && recv === 0 && tick > 200) ? '#f44' : '#0f0';
    }

    /**
     * Show a temporary on-screen notice (visible without dev console).
     * Auto-fades after 5 seconds.
     * @param {string} text - Message to display
     * @param {string} [color='#0f0'] - CSS color
     */
    _showScreenNotice(text, color = '#0f0') {
        const el = document.createElement('div');
        el.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:${color};font-family:monospace;font-size:18px;padding:16px 32px;z-index:99999;border-radius:8px;border:2px solid ${color};pointer-events:none;transition:opacity 1s;`;
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; }, 4000);
        setTimeout(() => { el.remove(); }, 5000);
    }

    // R013: Apply position sync from Host (called by SessionManager._handlePositionSync)
    // Lives here because Game.js has THREE.Vector3 for path reconstruction
    applyPositionSync(msg) {
        const units = msg.units;
        if (!units || !Array.isArray(units)) return;

        const mySelectedUnit = this.selectedUnit;
        const mySlot = this.sessionManager?.state?.mySlot;

        for (const uData of units) {
            const unit = this.units.find(u => u && u.id === uData.id);
            if (!unit) continue;

            // Don't override Guest's own controlled unit
            if (unit === mySelectedUnit && unit.selectedBySlot === mySlot) continue;

            // Apply position
            unit.position.set(uData.px, uData.py, uData.pz);

            // Apply rotation
            if (unit.mesh?.quaternion) {
                unit.mesh.quaternion.set(uData.qx, uData.qy, uData.qz, uData.qw);
            }
            if (unit.headingQuaternion) {
                unit.headingQuaternion.set(uData.qx, uData.qy, uData.qz, uData.qw);
            }

            // Reconstruct path from flat array [x,y,z, x,y,z, ...]
            if (uData.pp && uData.pp.length >= 3) {
                const newPath = [];
                for (let i = 0; i < uData.pp.length; i += 3) {
                    newPath.push(new THREE.Vector3(uData.pp[i], uData.pp[i+1], uData.pp[i+2]));
                }
                unit.path = newPath;
            } else {
                unit.path = [];
            }

            // Apply path-following flags
            unit.isFollowingPath = uData.fp === 1;
            unit.pathIndex = uData.pi || 0;
            unit.isPathClosed = uData.pc === 1;
            unit.isKeyboardOverriding = uData.kb === 1;

            if (unit.isKeyboardOverriding) {
                unit.isFollowingPath = false;
            }
        }
    }

    /**
     * Phase 2A: Apply SERVER_SNAPSHOT from authoritative server.
     * Pushes to SnapshotBuffer and activates mirror mode on first snapshot.
     * @param {Object} msg - SERVER_SNAPSHOT message { type, version, tick, serverTimeMs, units }
     */
    applyServerSnapshot(msg) {
        // Activate mirror mode on first SERVER_SNAPSHOT
        if (!this._mirrorMode) {
            this._mirrorMode = true;
            this._snapshotBuffer.reset();
            console.log('[Game] Mirror mode ACTIVATED (first SERVER_SNAPSHOT received)');
            this._showScreenNotice('MIRROR MODE ACTIVE — Server Authority', '#00ff88');
        }

        this._snapshotBuffer.push(msg);
    }

    // R012: Update DB status in unified NetworkDebugPanel (called by save/load)
    _updateDBStatus(msg, isError = false) {
        if (!this.networkDebugPanel) return;
        this.networkDebugPanel.setDBStatus(msg, isError);
    }

    // R012: Poll Supabase transport state and update REALTIME status in panel
    _startRealtimeStatusPolling() {
        if (!this._supabaseTransport || !this.networkDebugPanel) return;

        let lastState = null;
        const poll = () => {
            const state = this._supabaseTransport.state;
            if (state !== lastState) {
                lastState = state;
                let rtText = 'UNKNOWN';
                let rtColor = '#f44336';
                if (state === 'CONNECTED') { rtText = 'CONNECTED'; rtColor = '#4caf50'; }
                else if (state === 'CONNECTING') { rtText = 'CONNECTING...'; rtColor = '#ff9800'; }
                else if (state === 'DISCONNECTED') { rtText = 'DISCONNECTED'; rtColor = '#f44336'; }
                else if (state === 'ERROR') { rtText = 'ERROR'; rtColor = '#f44336'; }

                this.networkDebugPanel.setRealtimeStatus(rtText, rtColor);
            }
        };

        // Poll every 500ms
        this._rtStatusInterval = setInterval(poll, 500);
        poll(); // Initial check
    }

    // R012: Initialize Supabase auth (anonymous sign-in for persistence)
    async _initSupabaseAuth(client) {
        try {
            // Check if already signed in
            const { data: { user } } = await client.auth.getUser();
            if (user) {
                console.log('[Game] Supabase auth: Already signed in as', user.id);
                this._supabaseUserId = user.id;
                return;
            }

            // Sign in anonymously
            const { data, error } = await client.auth.signInAnonymously();
            if (error) {
                console.error('[Game] Supabase anonymous sign-in failed:', error.message);
                if (this.networkDebugPanel) {
                    this.networkDebugPanel.setNetStatus('SUPABASE', { auth: 'AUTH FAIL' });
                }
                return;
            }

            this._supabaseUserId = (data.user && data.user.id) ? data.user.id : null;
            console.log('[Game] Supabase auth: Signed in anonymously as', this._supabaseUserId);
        } catch (err) {
            console.error('[Game] Supabase auth error:', err);
        }
    }

    loadUnits() {
        // Use the centralized loading manager
        const loader = new GLTFLoader(this.loadingManager);
        // All 10 units - Unit 1 spawns in front of camera, models cycle through 5 available GLBs
        const availableModels = ['1.glb', '2.glb', '3.glb', '4.glb', '5.glb'];
        const models = Array.from({ length: 10 }, (_, i) => availableModels[i % availableModels.length]);
        let loadedCount = 0;

        // Pre-allocate units array to preserve order
        this.units = new Array(models.length).fill(null);

        // R013 M07 FIX: Pre-compute unit IDs BEFORE async loading
        // This ensures deterministic IDs regardless of model load order
        const unitIds = models.map(() => nextEntityId());

        models.forEach((modelName, index) => {
            loader.load(`./modellek/${modelName}`, (gltf) => {
                const model = gltf.scene;

                // Create a Unit wrapper (R003: deterministic ID - now uses pre-computed ID)
                const unitId = unitIds[index];
                const unit = new Unit(this.planet, unitId);
                unit.name = `Unit ${unitId}`; // Set unit name from ID
                // R013 M07: Ownership tracking (0 = Host, assigned on join for guests)
                unit.ownerSlot = 0; // Default: Host owns all initial units
                unit.recordOwnershipChange(0, null, this.simLoop?.tickCount || 0, 'SPAWN');
                unit.modelIndex = index % availableModels.length; // Phase 2A: for SPAWN_MANIFEST

                // M07 GAP-0: PIN protection for testing
                // First unit (index 0) stays OPEN for immediate host control.
                // Remaining units get PIN_1DIGIT so guests must enter a PIN.
                if (index > 0) {
                    unit.seatPolicy = 'PIN_1DIGIT';
                    // Deterministic PIN for testing: unit index mod 9 + 1 (yields 1-9)
                    unit.seatPinDigit = (index % 9) + 1;
                }

                // Replace the default cube mesh with the loaded model
                // CRITICAL FIX: Do NOT replace unit.mesh (Group). Add model TO it.
                // Remove the dummy body mesh first (if exposed, or try finding it)
                if (unit.bodyMesh) {
                    unit.mesh.remove(unit.bodyMesh);
                } else {
                    // Fallback: Remove first mesh child that isn't the ring
                    // But expose worked, so we use unit.bodyMesh
                }
                
                // Add GLTF model to the Unit's Group
                unit.mesh.add(model);
                
                // Apply shadow props to model
                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        child.renderOrder = 20;
                    }
                });

                // Ensure unit.mesh is in scene (it is added by default? No need to remove/add)
                // If it was already in scene, this update is visible immediately.
                this.scene.add(unit.mesh); // Ensure it's there

                // Scale model if needed
                unit.mesh.scale.set(0.5, 0.5, 0.5);

                // Unit position: Unit 1 at camera-facing position (preloader center), others random
                if (index === 0) {
                    // UNIT 1: Fixed position - directly in front of initial camera
                    // Camera starts looking at planet center, so place unit at "front" of planet
                    const radius = this.planet.terrain.params.radius + 0.5;
                    // Position at Z+ direction (initial camera typically looks toward this)
                    unit.position.set(0, 0, radius);
                } else {
                    // Other units: Random position on sphere
                    // Phase 1: Spawn Safety - Retry to avoid rocks
                    const randomPos = new THREE.Vector3();
                    let safeFound = false;
                    const maxRetries = 15;

                    for (let r = 0; r < maxRetries; r++) {
                        // R004: seeded RNG for deterministic spawn positions
                        const theta = rngNext() * Math.PI * 2;
                        const phi = Math.acos(2 * rngNext() - 1);
                        const radius = this.planet.terrain.params.radius + 10;

                        randomPos.set(
                            radius * Math.sin(phi) * Math.cos(theta),
                            radius * Math.sin(phi) * Math.sin(theta),
                            radius * Math.cos(phi)
                        );
                        
                        // Check against rocks
                        let collision = false;
                        if (this.rockSystem && this.rockSystem.rocks) {
                            for (const rock of this.rockSystem.rocks) {
                                // Safe distance check: Rock radius (~2-3) + Unit (~1) + Buffer
                                // Fix: Increased from 4.0 to 7.0 to account for large rocks (scale 3.0)
                                if (rock.position.distanceTo(randomPos) < 7.0) {
                                    collision = true;
                                    break;
                                }
                            }
                        }
                        
                        // FIX: Also check for WATER - unit cannot spawn underwater
                        if (!collision && this.planet && this.planet.terrain) {
                            const waterLevel = this.planet.terrain.params.waterLevel || 0;
                            const baseRadius = this.planet.terrain.params.radius;
                            const waterRadius = baseRadius + waterLevel;
                            
                            // Project spawn pos to terrain surface to check actual height
                            const dir = randomPos.clone().normalize();
                            const actualTerrainRadius = this.planet.terrain.getRadiusAt(dir);
                            
                            if (actualTerrainRadius < waterRadius + 0.5) {
                                collision = true; // Underwater - try again
                            }
                        }

                        if (!collision) {
                            safeFound = true;
                            break;
                        }
                    }

                    if (!safeFound) {
                        console.warn(`[Game] Could not find safe spawn for Unit ${index+1} after ${maxRetries} tries.`);
                    }

                    unit.position.copy(randomPos);
                }
                unit.snapToSurface();

                // Add unit sound
                this.audioManager.addUnitSound(unit);

                // Insert at specific index to preserve order
                this.units[index] = unit;
                loadedCount++;

                // Generate tabs after all units loaded
                if (loadedCount === models.length) {
                    this.generateUnitTabs();
                    this.setupPanelControls();
                    // Phase 2A: If already hosting, send manifest now (idempotent)
                    this._sendSpawnManifest();
                }

                // #1: No auto-select at startup. Camera positions on first unit but nothing is selected.
                if (index === 0) {
                    this.positionCameraAboveUnit(unit);
                }
            });
        });
    }

    // === Phase 2A: Manifest & Visual Shells ===

    /**
     * Phase 2A: Send SPAWN_MANIFEST to server (host only, exactly once).
     * Called after hostGame() and/or after all units finish loading.
     * Gated by _manifestSent to guarantee single delivery.
     * @private
     */
    _sendSpawnManifest() {
        if (this._manifestSent) return;
        if (!this.sessionManager?.isHost?.()) return;
        const channel = this.sessionManager?._sessionChannel;
        if (!channel || !this.sessionManager?.transport?.broadcastToChannel) return;

        const manifest = this.units.filter(u => u).map(u => ({
            id: u.id,
            ownerSlot: u.ownerSlot ?? 0,
            modelIndex: u.modelIndex ?? 0,
            px: u.position.x,
            py: u.position.y,
            pz: u.position.z
        }));

        if (manifest.length === 0) return;

        this.sessionManager.transport.broadcastToChannel(channel, {
            type: 'SPAWN_MANIFEST',
            units: manifest,
            timestamp: Date.now()
        });

        this._manifestSent = true;
        if (this._isDevMode) {
            console.log(`[Game] SPAWN_MANIFEST sent (${manifest.length} units)`);
        }
    }

    /**
     * Phase 2A: Create a visual-only Unit shell from a server snapshot entry.
     * Used when reconciliation detects a server unit with no local counterpart.
     * Loads the correct GLTF model asynchronously (non-blocking).
     *
     * @param {Object} snap - Snapshot unit: { id, ownerSlot, modelIndex, px, py, pz, qx, qy, qz, qw }
     * @private
     */
    _createVisualShellFromSnapshot(snap) {
        if (!this.planet || !this.planet.terrain) return;

        const unit = new Unit(this.planet, snap.id);
        unit.name = `Unit ${snap.id}`;
        unit.ownerSlot = snap.ownerSlot ?? 0;
        unit.selectedBySlot = null;
        unit.modelIndex = snap.modelIndex ?? 0;

        // Position from snapshot
        unit.position.set(snap.px, snap.py, snap.pz);
        unit._interpPrevPos.set(snap.px, snap.py, snap.pz);
        unit._interpCurrPos.set(snap.px, snap.py, snap.pz);
        unit._interpInitialized = true;

        // Orientation from snapshot (if available)
        if (snap.qw !== undefined && unit.mesh) {
            unit.mesh.quaternion.set(snap.qx, snap.qy, snap.qz, snap.qw);
            unit._interpPrevQuat.set(snap.qx, snap.qy, snap.qz, snap.qw);
            unit._interpCurrQuat.set(snap.qx, snap.qy, snap.qz, snap.qw);
        }

        // Sync mesh position
        unit.mesh.position.copy(unit.position);

        // Add to scene
        this.scene.add(unit.mesh);
        unit.mesh.scale.set(0.5, 0.5, 0.5);

        // Load correct GLTF model async (non-blocking placeholder until loaded)
        const availableModels = ['1.glb', '2.glb', '3.glb', '4.glb', '5.glb'];
        const modelName = availableModels[snap.modelIndex % availableModels.length];
        const loader = new GLTFLoader(this.loadingManager);
        loader.load(`./modellek/${modelName}`, (gltf) => {
            const model = gltf.scene;
            if (unit.bodyMesh) unit.mesh.remove(unit.bodyMesh);
            unit.mesh.add(model);
            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.renderOrder = 20;
                }
            });
        });

        // Add audio if available
        if (this.audioManager) {
            this.audioManager.addUnitSound(unit);
        }

        // Add to units array (becomes visible to interpolation on next tick)
        this.units.push(unit);

        if (this._isDevMode) {
            console.log(`[Game] Visual shell created for server unit ${snap.id} (slot ${snap.ownerSlot}, model ${snap.modelIndex})`);
        }

        this.generateUnitTabs();
    }

    // === R013: Guest Unit Spawning ===

    /**
     * Spawn a new unit for a player who just joined.
     * Loads a proper GLTF model (same as initial host units).
     * Positions the unit on the planet surface, avoiding rocks and water.
     *
     * @param {number} slot - Player slot number (ownerSlot)
     * @returns {Unit|null} The spawned unit, or null if planet not ready
     */
    _spawnUnitForPlayer(slot) {
        // Phase 2A: Suppress local spawns when server authority is active
        if (this._mirrorMode) {
            if (this._isDevMode) {
                console.log(`[Game] Spawn suppressed for slot ${slot} (mirror mode active)`);
            }
            return null;
        }

        if (!this.planet || !this.planet.terrain) {
            console.warn('[Game] Cannot spawn unit: planet not ready');
            return null;
        }

        const unitId = nextEntityId();
        const unit = new Unit(this.planet, unitId);
        unit.name = `Unit ${unitId}`;
        unit.ownerSlot = slot;
        unit.selectedBySlot = null; // Not seated yet - will be seated on select
        unit.seatPolicy = 'OPEN'; // Guest units are open for their owner
        unit.modelIndex = unitId % 5; // Phase 2A: track which GLTF model (for manifest/snapshot)
        // Position: random safe location on planet surface (same logic as loadUnits)
        const randomPos = new THREE.Vector3();
        let safeFound = false;
        const maxRetries = 15;

        for (let r = 0; r < maxRetries; r++) {
            const theta = rngNext() * Math.PI * 2;
            const phi = Math.acos(2 * rngNext() - 1);
            const radius = this.planet.terrain.params.radius + 10;

            randomPos.set(
                radius * Math.sin(phi) * Math.cos(theta),
                radius * Math.sin(phi) * Math.sin(theta),
                radius * Math.cos(phi)
            );

            // Check against rocks
            let collision = false;
            if (this.rockSystem && this.rockSystem.rocks) {
                for (const rock of this.rockSystem.rocks) {
                    if (rock.position.distanceTo(randomPos) < 7.0) {
                        collision = true;
                        break;
                    }
                }
            }

            // Check for water
            if (!collision && this.planet && this.planet.terrain) {
                const waterLevel = this.planet.terrain.params.waterLevel || 0;
                const baseRadius = this.planet.terrain.params.radius;
                const waterRadius = baseRadius + waterLevel;

                const dir = randomPos.clone().normalize();
                const actualTerrainRadius = this.planet.terrain.getRadiusAt(dir);

                if (actualTerrainRadius < waterRadius + 0.5) {
                    collision = true;
                }
            }

            if (!collision) {
                safeFound = true;
                break;
            }
        }

        if (!safeFound) {
            console.warn(`[Game] Could not find safe spawn for guest unit (slot ${slot}) after ${maxRetries} tries.`);
        }

        unit.position.copy(randomPos);
        unit.snapToSurface();

        // Sync mesh position immediately
        unit.mesh.position.copy(unit.position);

        // Add to scene
        this.scene.add(unit.mesh);

        // Scale to match existing units
        unit.mesh.scale.set(0.5, 0.5, 0.5);

        // Load a proper GLTF model (same as host units) to replace the default cone
        const availableModels = ['1.glb', '2.glb', '3.glb', '4.glb', '5.glb'];
        const modelName = availableModels[unitId % availableModels.length];
        const loader = new GLTFLoader(this.loadingManager);
        loader.load(`./modellek/${modelName}`, (gltf) => {
            const model = gltf.scene;

            // Remove the default cone body mesh
            if (unit.bodyMesh) {
                unit.mesh.remove(unit.bodyMesh);
            }

            // Add GLTF model to the Unit's Group
            unit.mesh.add(model);

            // Apply shadow props to model
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.renderOrder = 20;
                }
            });
        });

        // Add unit sound
        if (this.audioManager) {
            this.audioManager.addUnitSound(unit);
        }

        // Add to units array
        this.units.push(unit);

        console.log(`[Game] Spawned unit ${unitId} for player slot ${slot} at`, unit.position.toArray().map(v => v.toFixed(1)));

        // Refresh tabs so the new unit appears
        this.generateUnitTabs();

        return unit;
    }

    // === Interaction Delegates (V3) ===

    selectUnit(unit, skipCamera = false) {
        const isSameUnit = (this.selectedUnit === unit);

        // Only do visual selection changes if different unit
        if (!isSameUnit) {
            this.deselectUnit();

            this.selectedUnit = unit;
            unit.setSelection(true);

            // Keep unit in view during all camera operations
            if (this.cameraControls) {
                this.cameraControls.keepInViewUnit = unit;
            }

            // #3 OCCUPIED: Mark unit as seated + owned by this player and broadcast
            const mySlot = this.sessionManager?.state?.mySlot ?? 0;
            unit.selectedBySlot = mySlot;
            const prevOwner = unit.ownerSlot;
            unit.ownerSlot = mySlot; // Ownership transfers to whoever sits down
            if (prevOwner !== mySlot) {
                unit.recordOwnershipChange(mySlot, prevOwner, this.simLoop?.tickCount || 0, 'SEAT_CLAIM');
            }

            // Broadcast seat claim to all other clients (so they see OCCUPIED)
            if (this.sessionManager?.broadcastSeatClaim) {
                this.sessionManager.broadcastSeatClaim(unit, mySlot);
            }

            // Show path markers
            this.showUnitMarkers(unit);

            // ZOOM CAMERA TO SHOW FULL PATH (unless skipCamera = true)
            if (!skipCamera) {
                this.zoomCameraToPath(unit);
            }

            if (this._isDevMode) console.log("Unit Selected:", unit);

            // Update tab active state
            this.updateTabActiveState();
        }

        // ALWAYS sync focusedUnit and update panel (even for same unit)
        this.focusedUnit = unit;
        this.updatePanelContent(unit);
    }

    // Zoom camera to show unit's entire path with smooth transition
    zoomCameraToPath(unit) {
        if (!unit || !this.cameraControls) return;

        // Get all path CONTROL POINTS (waypoints) including unit position
        const points = [unit.position.clone()];

        // Use waypointControlPoints - these are the actual user-defined waypoints
        if (unit.waypointControlPoints && unit.waypointControlPoints.length > 0) {
            for (const wp of unit.waypointControlPoints) {
                points.push(wp.clone());
            }
        }

        if (points.length === 1) {
            // No path - just fly to unit with standard flyTo
            this.cameraControls.flyTo(unit);
            return;
        }

        // === CALCULATE BOUNDING SPHERE ===
        const center = new THREE.Vector3();
        for (const p of points) {
            center.add(p);
        }
        center.divideScalar(points.length);

        // Find max distance from center (bounding radius)
        let maxDist = 0;
        for (const p of points) {
            const d = center.distanceTo(p);
            if (d > maxDist) maxDist = d;
        }

        // === CALCULATE CAMERA DISTANCE ===
        // Add 50% padding as specified for path visibility with environment context
        const fov = this.camera.fov * Math.PI / 180;
        const aspect = this.camera.aspect;
        const effectiveFov = Math.min(fov, fov * aspect);
        const cameraDistance = (maxDist * 1.8) / Math.tan(effectiveFov / 2);

        // Clamp distance to reasonable range
        const finalDistance = Math.max(20, Math.min(200, cameraDistance + 8));

        // === CALCULATE CAMERA POSITION ===
        // AXONOMETRIC VIEW: 45° from above, 45° from side, 45° from front
        // Like Civilization/SimCity drone perspective
        const centerDir = center.clone().normalize(); // "Up" direction at center

        // Get unit's forward direction
        const unitForward = new THREE.Vector3(0, 0, 1);
        if (unit.headingQuaternion) {
            unitForward.applyQuaternion(unit.headingQuaternion);
        }

        // Project forward onto tangent plane (remove radial component)
        const tangentForward = unitForward.clone()
            .sub(centerDir.clone().multiplyScalar(unitForward.dot(centerDir)))
            .normalize();

        // Create orthonormal basis on tangent plane
        const tangentRight = new THREE.Vector3().crossVectors(centerDir, tangentForward).normalize();

        // 45° angles: sin(45°) = cos(45°) = 0.707
        const angle45 = Math.PI / 4; // 45 degrees

        // Camera offset: 
        // - Height: finalDistance * sin(45°) above center 
        // - Forward: finalDistance * cos(45°) * cos(45°) back
        // - Side: finalDistance * cos(45°) * sin(45°) to the right
        const heightOffset = finalDistance * Math.sin(angle45);
        const horizontalDist = finalDistance * Math.cos(angle45);
        const forwardOffset = -horizontalDist * Math.cos(angle45); // Behind
        const sideOffset = horizontalDist * Math.sin(angle45);     // To the side

        const cameraPos = center.clone()
            .addScaledVector(centerDir, heightOffset)          // Up
            .addScaledVector(tangentForward, forwardOffset)    // Back
            .addScaledVector(tangentRight, sideOffset);        // Side

        // === SMOOTH TRANSITION ===
        // Look at center of bounding sphere
        this.cameraControls.smoothTransitionToTarget(cameraPos, center, 1.5);
    }

    // UNIT FULL VIEW: Frame unit + path + vision radius (Civilization-style top-down)
    flyToUnitFullView(unit) {
        if (!unit || !this.cameraControls) return;

        // === COLLECT BOUNDING POINTS ===
        // 1. Unit position
        const points = [unit.position.clone()];

        // 2. Path waypoints
        if (unit.waypointControlPoints && unit.waypointControlPoints.length > 0) {
            for (const wp of unit.waypointControlPoints) {
                points.push(wp.clone());
            }
        }

        // 3. Vision radius boundary points (8 samples around unit)
        const visionRadius = this.fogOfWar.currentVisionRadius || 15.0;
        const unitDir = unit.position.clone().normalize();

        // Create tangent basis at unit position
        const tangent1 = new THREE.Vector3(1, 0, 0).cross(unitDir).normalize();
        if (tangent1.lengthSq() < 0.01) {
            tangent1.set(0, 1, 0).cross(unitDir).normalize();
        }
        const tangent2 = new THREE.Vector3().crossVectors(unitDir, tangent1).normalize();

        // Sample 8 points around vision circle
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const offset = tangent1.clone().multiplyScalar(Math.cos(angle) * visionRadius)
                .add(tangent2.clone().multiplyScalar(Math.sin(angle) * visionRadius));

            // Project to terrain surface
            const visionPoint = unit.position.clone().add(offset);
            const visionDir = visionPoint.normalize();
            const terrainRadius = this.planet.terrain.getRadiusAt(visionDir);
            visionPoint.copy(visionDir.multiplyScalar(terrainRadius));

            points.push(visionPoint);
        }

        // === CALCULATE BOUNDING SPHERE ===
        const center = new THREE.Vector3();
        for (const p of points) {
            center.add(p);
        }
        center.divideScalar(points.length);

        // Find max distance from center
        let maxDist = 0;
        for (const p of points) {
            const d = center.distanceTo(p);
            if (d > maxDist) maxDist = d;
        }

        // === CALCULATE CAMERA DISTANCE ===
        // Tighter framing (reduced padding)
        const fov = this.camera.fov * Math.PI / 180;
        const aspect = this.camera.aspect;
        const effectiveFov = Math.min(fov, fov * aspect);
        const cameraDistance = (maxDist * 1.1) / Math.tan(effectiveFov / 2); // Reduced from 1.5x to 1.1x

        const finalDistance = Math.max(20, Math.min(200, cameraDistance + 10));

        // === CALCULATE CAMERA POSITION (Top-Down/Isometric, Closest Angle) ===
        // 1. Define ideal viewing circle parameters
        const angle45 = Math.PI / 4; // 45 degree elevation
        const heightOffset = finalDistance * Math.sin(angle45);
        const horizontalRadius = finalDistance * Math.cos(angle45);

        // 2. Determine current camera direction relative to center (in horizontal plane)
        // This ensures we fly to the CLOSEST point on the viewing circle
        const currentCamPos = this.camera.position.clone();
        const centerDir = center.clone().normalize(); // Up vector at target

        // Vector from center to camera
        const toCamera = currentCamPos.clone().sub(center);

        // Project onto tangent plane (remove up component)
        // This gives us the direction from center to camera "on the ground"
        let approachDir = toCamera.clone()
            .sub(centerDir.clone().multiplyScalar(toCamera.dot(centerDir)))
            .normalize();

        // Fallback if camera is perfectly above (length is 0) -> use South
        if (approachDir.lengthSq() < 0.01) {
            // Default to consistent direction if vertical
            // Use unit's forward or global Z
            const unitForward = new THREE.Vector3(0, 0, 1);
            if (unit.headingQuaternion) {
                unitForward.applyQuaternion(unit.headingQuaternion);
            }
            // Project forward onto plane
            approachDir = unitForward.clone()
                .sub(centerDir.clone().multiplyScalar(unitForward.dot(centerDir)))
                .normalize()
                .negate(); // View from behind/south
        }

        // 3. Calculate Target Position on the optimized circle point
        // Position = Center + Up * Height + ApproachDir * HorizontalRadius
        const cameraPos = center.clone()
            .addScaledVector(centerDir, heightOffset)       // Height (Up)
            .addScaledVector(approachDir, horizontalRadius); // Horizontal distance (preserving current angle)

        // 4. Create orthonormal basis for camera orientation?
        // Not needed for position calculation, lookAt handles orientation.

        // === SMOOTH TRANSITION (ballistic arc, ease-in/out) ===
        this.cameraControls.ballisticTransitionToTarget(cameraPos, center);
    }

    deselectUnit() {
        if (this.selectedUnit) {
            // SEAT_RELEASE: broadcast seat release to all clients (or local clear if offline)
            if (this.sessionManager?.releaseSeat) {
                this.sessionManager.releaseSeat(this.selectedUnit);
            } else {
                this.selectedUnit.selectedBySlot = null;
            }

            this.selectedUnit.setSelection(false);

            // HIDE this unit's path markers
            this.hideUnitMarkers(this.selectedUnit);

            this.selectedUnit = null;

            // Release unit-in-view constraint
            if (this.cameraControls) {
                this.cameraControls.keepInViewUnit = null;
            }
        }

        // Also Exit Focus Mode if active
        this.exitFocusMode();

        // Update tab active state
        this.updateTabActiveState();
    }

    // === Unit Tab System ===

    generateUnitTabs() {
        const tabContainer = document.getElementById('unit-tabs');
        if (!tabContainer) return;

        tabContainer.innerHTML = '';

        // Filter units based on role and seat authority
        const role = this.sessionManager?.state?.role || 'OFFLINE';
        const mySlot = this.sessionManager?.state?.mySlot ?? 0;

        this.units.forEach((unit, index) => {
            if (!unit) return; // Guard against null entries in pre-allocated array
            // Tab filtering by OWNERSHIP (ownerSlot), not current driver (selectedBySlot)
            // ownerSlot = "who was the last person to sit in this unit"
            if (role === 'GUEST') {
                // Guest: show units I own (entered at least once)
                if (unit.ownerSlot !== mySlot) return;
            } else if (role === 'HOST') {
                // Host: show units I own (not taken over by someone else)
                if (unit.ownerSlot !== mySlot) return;
            }
            // OFFLINE: show all (no filter)
            const tab = document.createElement('div');
            tab.className = 'unit-tab';
            tab.textContent = `Unit ${index + 1}`;
            tab.dataset.unitIndex = index;

            tab.addEventListener('click', () => {
                this.onUnitTabClick(index);
            });

            // Tab Hover Events: Show waypoints at 50% scale when hovering
            tab.addEventListener('mouseenter', () => {
                const hoveredUnit = this.units[index];
                if (hoveredUnit && hoveredUnit !== this.selectedUnit) {
                    hoveredUnit.isHovered = true;
                    this.showUnitMarkers(hoveredUnit, 0.5); // 50% scale
                }
            });

            tab.addEventListener('mouseleave', () => {
                const hoveredUnit = this.units[index];
                if (hoveredUnit && hoveredUnit !== this.selectedUnit) {
                    hoveredUnit.isHovered = false;
                    this.hideUnitMarkers(hoveredUnit);
                }
            });

            tabContainer.appendChild(tab);
        });

        // ADD TOGGLE BUTTON (expand/collapse) to top-right of tab bar
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'panel-toggle-btn';
        toggleBtn.className = 'panel-toggle-btn';
        toggleBtn.innerHTML = '<span class="toggle-icon">▲</span>';
        toggleBtn.title = 'Expand/Collapse Panel';
        tabContainer.appendChild(toggleBtn);

        // Attach toggle click handler directly on the new button
        // (must be re-attached every time tabs are regenerated since innerHTML is cleared)
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePanel();
        });

        // Update active state if a unit is already selected
        this.updateTabActiveState();

        // Header Click DESELECT (Empty space) - only attach once to avoid stacking
        if (!this._tabContainerClickBound) {
            this._tabContainerClickBound = true;
            tabContainer.addEventListener('click', (e) => {
                // If clicked directly on the container (gap), not on a tab
                if (e.target === tabContainer) {
                    if (this._isDevMode) console.log('Clicked header empty space -> Deselect');
                    this.deselectUnit();
                }
            });
        }

        console.log(`Generated ${this.units.length} unit tabs with toggle button`);
    }

    setupPanelControls() {
        // Guard against duplicate drag handler setup (this is only called once,
        // but defend against accidental re-calls)
        if (this._panelControlsInitialized) return;
        this._panelControlsInitialized = true;

        // NOTE: Toggle button click handler is now attached in generateUnitTabs()
        // because generateUnitTabs() destroys and recreates the button via innerHTML=''.

        const unitTabs = document.getElementById('unit-tabs');
        const bottomPanel = document.getElementById('bottom-panel');

        // Edge drag on unit-tabs row
        if (unitTabs && bottomPanel) {
            let startY = 0;
            let isDragging = false;
            let panelWasOpen = false;

            const onDragStart = (e) => {
                // Only start drag from top edge (first 20px)
                const rect = unitTabs.getBoundingClientRect();
                const y = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
                const offsetFromTop = y - rect.top;

                if (offsetFromTop > 20) return; // Only drag from top edge

                isDragging = true;
                startY = y;
                panelWasOpen = document.body.classList.contains('split-screen');

                // Disable transition during drag for responsive feel
                bottomPanel.style.transition = 'none';
            };

            const onDragMove = (e) => {
                if (!isDragging) return;
                e.preventDefault();

                const currentY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
                const deltaY = currentY - startY;

                // Real-time panel position update
                const panelHeight = bottomPanel.offsetHeight;
                const tabHeight = 52; // var(--tab-height)

                if (panelWasOpen) {
                    // Panel is open, dragging down should close
                    const newOffset = Math.max(0, Math.min(panelHeight - tabHeight, deltaY));
                    bottomPanel.style.transform = `translateY(${newOffset}px)`;
                } else {
                    // Panel is closed, dragging up should open
                    const closedOffset = panelHeight - tabHeight;
                    const newOffset = Math.max(0, closedOffset + deltaY);
                    bottomPanel.style.transform = `translateY(${newOffset}px)`;
                }
            };

            const onDragEnd = () => {
                if (!isDragging) return;
                isDragging = false;

                // IMPORTANT: Read current drag position BEFORE clearing the inline transform,
                // otherwise getBoundingClientRect returns the CSS-defined position (open or closed)
                // rather than where the user actually dragged to.
                const rect = bottomPanel.getBoundingClientRect();
                const screenHeight = window.innerHeight;
                const panelTop = rect.top;
                const threshold = screenHeight * 0.6; // 60% threshold

                // Re-enable smooth transition and clear inline transform
                bottomPanel.style.transition = '';
                bottomPanel.style.transform = '';

                if (panelTop < threshold) {
                    // Panel is mostly shown -> snap to open
                    this.openPanel();
                } else {
                    // Panel is mostly hidden -> snap to closed
                    this.closePanel();
                }
            };

            unitTabs.addEventListener('mousedown', onDragStart);
            window.addEventListener('mousemove', onDragMove);
            window.addEventListener('mouseup', onDragEnd);

            // Touch support
            unitTabs.addEventListener('touchstart', onDragStart, { passive: false });
            window.addEventListener('touchmove', onDragMove, { passive: false });
            window.addEventListener('touchend', onDragEnd);
        }
    }

    togglePanel() {
        if (document.body.classList.contains('split-screen')) {
            this.closePanel();
        } else {
            this.openPanel();
        }
    }

    openPanel() {
        document.body.classList.add('split-screen');
        // If a unit is selected, update panel content
        if (this.selectedUnit) {
            this.isFocusMode = true;
            this.focusedUnit = this.selectedUnit;
            this.updatePanelContent(this.selectedUnit);
        }
    }

    closePanel() {
        document.body.classList.remove('split-screen');
        this.isFocusMode = false;
        // Keep focusedUnit so it can be restored
    }

    onUnitTabClick(unitIndex) {
        const unit = this.units[unitIndex];
        if (!unit) return;

        const now = Date.now();
        const doubleClickThreshold = 300; // ms

        // M07 B4-fix: Gate tab click by seat authority
        // If guest doesn't have seat, trigger seat flow instead of blocking
        if (!(this.sessionManager?.hasSeatedUnit?.(unit) ?? true)) {
            if (this._isDevMode) console.warn("[Game] Tab click: no seat on unit " + unit.id + ", triggering seat flow");
            if (this.interactionManager) {
                this.interactionManager._triggerSeatFlow(unit);
            }
            return;
        }

        // Check for double click
        if (this.lastTabClickIndex === unitIndex &&
            this.lastTabClickTime &&
            (now - this.lastTabClickTime) < doubleClickThreshold) {
            // DOUBLE CLICK: Open panel if closed, or just re-focus
            this.enterFocusMode(unit);
            this.lastTabClickTime = 0; // Reset
            if (this._isDevMode) console.log(`Tab DOUBLE clicked: Unit ${unitIndex + 1} - Opening panel`);
        } else {
            // SINGLE CLICK
            if (this.isFocusMode) {
                // If panel is ALREADY open, single click should switch content seamlessly
                this.enterFocusMode(unit);
                if (this._isDevMode) console.log(`Tab clicked (Panel Open): Unit ${unitIndex + 1} - Switch content`);
            } else {
                // Panel is CLOSED: Just select and fly
                this.selectAndFlyToUnit(unit);
                if (this._isDevMode) console.log(`Tab clicked (Panel Closed): Unit ${unitIndex + 1} - Select only`);
            }
        }

        this.lastTabClickIndex = unitIndex;
        this.lastTabClickTime = now;

        this.updateTabActiveState();
    }

    /**
     * Select a unit and zoom camera to show its ENTIRE PATH.
     * Does NOT open the bottom panel.
     */
    selectAndFlyToUnit(unit) {
        if (!unit) return;

        const isNewUnit = (this.selectedUnit !== unit);

        // Select the unit (skip camera zoom - we call it manually below)
        this.selectUnit(unit, true);

        // Reset camera mode to drone (top-down view)
        // Third-person only activates when keyboard is pressed
        if (this.cameraControls) {
            this.cameraControls.chaseMode = 'drone';
            this.cameraControls.chaseTarget = null;
        }

        // Camera: Zoom to UNIT FULL VIEW (path + vision radius)
        if (isNewUnit) {
            this.flyToUnitFullView(unit);
        }

        // Keep panel closed (don't add split-screen class)
        // But update tab active state
        this.updateTabActiveState();
    }

    updateTabActiveState() {
        const tabs = document.querySelectorAll('.unit-tab');
        let activeTab = null;
        tabs.forEach((tab) => {
            const unitIdx = parseInt(tab.dataset.unitIndex);
            if (this.units[unitIdx] === this.selectedUnit) {
                tab.classList.add('active');
                activeTab = tab;
            } else {
                tab.classList.remove('active');
            }
        });

        // Scroll the active tab into view if it's off-screen in the tab bar
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    }

    // DELETED: duplicate deselectUnit() was here. Canonical version is above (with SEAT_RELEASE).

    hideUnitMarkers(unit) {
        if (!unit) return;

        if (unit.waypointMarkers) {
            unit.waypointMarkers.forEach(m => {
                m.visible = false;
                if (m.userData.labelSprite) {
                    m.userData.labelSprite.visible = false;
                }
            });
        }
        if (unit.waypointCurveLine) {
            unit.waypointCurveLine.visible = false;
        }
    }

    showUnitMarkers(unit, scale = 0.5) {
        if (!unit) return;

        if (unit.waypointMarkers) {
            unit.waypointMarkers.forEach(m => {
                m.visible = true;
                m.scale.setScalar(scale); // Apply scale (1.0 = full, 0.5 = half)
                if (m.userData.labelSprite) {
                    m.userData.labelSprite.visible = true;
                    m.userData.labelSprite.scale.setScalar(scale);
                }
            });
        }
        if (unit.waypointCurveLine) {
            unit.waypointCurveLine.visible = true;
        }
    }

    setPathVisualizationVisible(visible) {
        // Legacy support / Helper for toggling CURRENT selection
        if (this.selectedUnit) {
            if (visible) {
                this.showUnitMarkers(this.selectedUnit);
            } else {
                this.hideUnitMarkers(this.selectedUnit);
            }
        }
    }

    createNumberSprite(number) {
        // Create a canvas with the number - NO circle background, thin font
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Clear (transparent background, no circle)
        ctx.clearRect(0, 0, 64, 64);

        // Draw number with thin font (like preloader "PLANET APPROACH" style)
        ctx.fillStyle = 'rgba(0, 255, 136, 1.0)';
        ctx.font = '200 24px "Inter", "Segoe UI", Arial'; // Thin weight (200), smaller size
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), 32, 32);

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);

        // Create sprite material
        const spriteMat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: true,
            depthWrite: false
        });

        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(0.8, 0.8, 1); // Smaller scale

        return sprite;
    }

    // === UNIFIED COMMAND QUEUE METHODS ===

    addCommand(unit, type, params = {}) {
        // R004: deterministic command ID from entity counter
        const id = 'cmd_' + nextEntityId();
        
        const command = {
            id: id,
            type: type, // 'Move', 'Wait', 'Attack', 'Build'
            params: params, // { position: Vector3, seconds: Number, etc. }
            status: 'pending'
        };

        // AUTO-INIT: If this is the FIRST Move command, add unit's current position as Start Point
        // This replicates legacy behavior where the first waypoint is the start position.
        const moveCommands = unit.commands.filter(c => c.type === 'Move');
        if (moveCommands.length === 0 && type === 'Move') {
             // R004: deterministic start command ID
             const startCmdId = 'cmd_start_' + nextEntityId();
             const startCmd = {
                 id: startCmdId,
                 type: 'Move',
                 params: { position: unit.position.clone() },
                 status: 'completed' // Start point is implicitly completed/passed
             };
             // Insert at beginning
             unit.commands.unshift(startCmd);
        }
        
        unit.commands.push(command);
        
        this.syncWaypointsFromCommands(unit);

        if (this.isFocusMode && this.focusedUnit === unit) {
            this.updatePanelContent(unit);
        }

        // Auto-switch tab to this unit when adding a waypoint (e.g. Shift+Click)
        if (type === 'Move' && unit === this.selectedUnit) {
            this.updateTabActiveState();
        }

        return command;
    }

    syncWaypointsFromCommands(unit) {
        // 1. Rebuild unit.waypoints from commands
        unit.waypoints = [];
        unit.waypointControlPoints = [];
        
        // Map commands to waypoints (Spatial commands only)
        unit.commands.forEach((cmd, index) => {
            if (cmd.type === 'Move' || (cmd.type === 'Build' && cmd.params.position)) {
                // Ensure position is a Vector3
                const pos = cmd.params.position instanceof THREE.Vector3 ? cmd.params.position : new THREE.Vector3().copy(cmd.params.position);
                
                const wp = {
                    id: cmd.id, // Link: Waypoint ID == Command ID
                    position: pos,
                    commandIndex: index,
                    // Preserve legacy states
                    logicalState: (cmd.status === 'completed') ? 'left' : 'neutral',
                    actionStartedCount: 0,
                    isStartMarker: (unit.waypoints.length === 0)
                };
                
                unit.waypoints.push(wp);
                unit.waypointControlPoints.push(wp.position);
            }
        });
        
        // 2. Sync Visual Markers
        // Ensure unit.waypointMarkers matches unit.waypoints length
        
        // Remove excess markers
        while (unit.waypointMarkers.length > unit.waypoints.length) {
            const m = unit.waypointMarkers.pop();
            this.scene.remove(m);
            if (m.userData.labelSprite) this.scene.remove(m.userData.labelSprite);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        }
        
        // Update/Create markers
        unit.waypoints.forEach((wp, i) => {
            let marker = unit.waypointMarkers[i];
            
            if (!marker) {
                // CREATE NEW MARKER
                const markerGeo = new THREE.SphereGeometry(0.8, 16, 16);
                const markerMat = new THREE.MeshBasicMaterial({
                    color: 0x00ff88,
                    transparent: true,
                    opacity: 0.7,
                    depthTest: true,
                    depthWrite: false
                });
                marker = new THREE.Mesh(markerGeo, markerMat);
                unit.waypointMarkers.push(marker);
                this.scene.add(marker);

                // Label
                const label = this.createNumberSprite(i);
                label.renderOrder = 15;
                marker.userData.labelSprite = label;
                this.scene.add(label);
            }
            
            // Sync Position (Snap to surface)
            const dir = wp.position.clone().normalize();
            // Safety: if position is (0,0,0) or invalid?
            if (dir.lengthSq() < 0.1) dir.set(0, 1, 0); 
            
            const terrainRadius = this.planet.terrain.getRadiusAt(dir);
            const markerPos = dir.clone().multiplyScalar(terrainRadius);
            
            marker.position.copy(markerPos);
            // Also update internal position to match snapped surface
            // wp.position.copy(markerPos); // Optional: force snap
            
            if (marker.userData.labelSprite) {
                marker.userData.labelSprite.position.copy(markerPos);
            }
            
            // Check label number consistency
            if (marker.userData.waypointNumber !== i) {
                 this.scene.remove(marker.userData.labelSprite);
                 const label = this.createNumberSprite(i);
                 label.position.copy(marker.position);
                 label.renderOrder = 15;
                 marker.userData.labelSprite = label;
                 this.scene.add(label);
            }
            
            // Update Metadata
            marker.userData.id = wp.id;
            marker.userData.unitId = unit.id;
            marker.userData.waypointNumber = i;
            marker.userData.controlPointIndex = i;
            marker.userData.isStartMarker = (i === 0);
            marker.userData.isFilled = (i === 0); 
            
            marker.scale.setScalar(0.5);
        });
        
        // 3. Update Curve Visualization
        this.updateWaypointCurve(unit);

    }

    addWaypoint(point) {
        if (!this.selectedUnit) return;
        // Wrapper for legacy calls -> New Command System
        this.addCommand(this.selectedUnit, 'Move', { position: point.clone() });
    }

    closePath() {
        // Called from InteractionManager when start marker is clicked
        if (!this.selectedUnit) return;
        this.closePathForUnit(this.selectedUnit);
    }

    /**
     * R013 M07: Close path for a specific unit (multiplayer-safe).
     * @param {Unit} unit - Target unit
     */
    closePathForUnit(unit) {
        if (!unit) return;

        if (unit.waypointControlPoints && unit.waypointControlPoints.length >= 3 && !unit.isPathClosed) {
            unit.loopingEnabled = true;
            unit.isPathClosed = true;
            if (this._isDevMode) console.log(`Path CLOSED for unit ${unit.id}`);

            // NOTE: Colors are managed by updateWaypointMarkerFill - do not hardcode here

            // Regenerate curve as closed loop
            // Pass unit explicitly so non-selected units also get their path populated
            this.updateWaypointCurve(unit);

            // Update Command Queue if panel is open
            if (this.isFocusMode && this.focusedUnit === unit) {
                this.updatePanelContent(this.focusedUnit);
            }
        }
    }

    updateWaypointCurve(targetUnit = null) {
        const unit = targetUnit || this.selectedUnit;
        if (!unit) return;

        if (!unit.waypointControlPoints || unit.waypointControlPoints.length < 2) return;

        // === CRITICAL: RE-CALCULATE TARGET BASED ON CURRENT SEQUENCE ===
        // User Requirement: lastWaypointId is STABLE on reorder/drag.
        // targetWaypointId = next waypoint AFTER lastWaypointId in CURRENT order.
        // This MUST run on every curve update to handle reordering!
        if (unit.waypoints && unit.waypoints.length > 0) {
            let newTargetIndex = 1; // Default

            if (unit.lastWaypointId) {
                const lastIdx = unit.waypoints.findIndex(wp => wp.id === unit.lastWaypointId);

                if (lastIdx !== -1) {
                    // Anchor found. Target is Next in current sequence.
                    newTargetIndex = lastIdx + 1;

                    // Loop Handling
                    if (newTargetIndex >= unit.waypoints.length) {
                        if (unit.isPathClosed) newTargetIndex = 0;
                        else newTargetIndex = unit.waypoints.length - 1; // Stay at end
                    }
                    
                    // ALWAYS update targetWaypointId to reflect current sequence order
                    const newTarget = unit.waypoints[newTargetIndex];
                    const oldTargetId = unit.targetWaypointId;
                    
                    if (newTarget && newTarget.id !== oldTargetId) {
                        unit.targetWaypointId = newTarget.id;
                        const oldTgtId = oldTargetId ? oldTargetId.slice(-4) : 'null';
                        const newTgtId = newTarget.id ? newTarget.id.slice(-4) : 'null';
                        const lastWpId = unit.lastWaypointId ? unit.lastWaypointId.slice(-4) : 'null';
                        if (this._isDevMode) console.log(`[REORDER] Target updated: ${oldTgtId} -> ${newTgtId} (after lastWaypointId ${lastWpId})`);
                        
                        // Update logical states
                        unit.waypoints.forEach(wp => {
                            if (wp.id === unit.lastWaypointId) {
                                wp.logicalState = 'left';
                            } else if (wp.id === unit.targetWaypointId) {
                                wp.logicalState = 'approaching';
                            } else {
                                wp.logicalState = 'neutral';
                            }
                        });
                    }
                } else {
                    // Anchor (lastWaypointId) was DELETED.
                    // Default to Index 1 (reset), but preserve lastWaypointId as stale reference
                    newTargetIndex = 1;
                    if (unit.waypoints.length < 2) newTargetIndex = 0;
                    
                    const newTarget = unit.waypoints[newTargetIndex];
                    if (newTarget) {
                        unit.targetWaypointId = newTarget.id;
                    }
                }
            } else {
                // No Anchor (Start) - Initialize
                newTargetIndex = 1;
                if (unit.waypoints.length < 2) newTargetIndex = 0;
                
                const newTarget = unit.waypoints[newTargetIndex];
                if (newTarget && !unit.targetWaypointId) {
                    unit.targetWaypointId = newTarget.id;
                    newTarget.logicalState = 'approaching';
                    
                    // Initialize lastWaypointId to first waypoint if not set
                    if (!unit.lastWaypointId && unit.waypoints.length > 0) {
                        unit.lastWaypointId = unit.waypoints[0].id;
                        unit.waypoints[0].logicalState = 'left';
                    }
                }
            }
        }

        // ============================================================================
        // BEZIER PATH GENERATION SYSTEM
        // ============================================================================
        // This system generates smooth, continuous paths through waypoints using
        // Cubic Bezier curves. Key features:
        // 
        // 1. AUTOMATIC TANGENT CALCULATION
        //    - Direction: (nextPoint - prevPoint).normalize()
        //    - Length: 40% of distance to neighbor
        //    - Collinear: in-tangent and out-tangent are on same line (C1 continuity)
        //
        // 2. OBSTACLE AVOIDANCE INTEGRATION
        //    - PathPlanner provides key detour points around rocks
        //    - These become additional Bezier waypoints
        //
        // 3. TERRAIN PROJECTION
        //    - Every sampled point is projected to terrain surface
        //    - Maintains correct altitude on hills/valleys
        //
        // 4. LOOP PATH SUPPORT
        //    - Closed paths connect last waypoint back to first
        //    - Tangents wrap around correctly
        // ============================================================================
        
        const groundOffset = unit.groundOffset || 0.5;
        const controlPoints = unit.waypointControlPoints;
        
        if (!controlPoints || controlPoints.length < 2) {
            // Not enough points for a path
            unit.path = [];
            return;
        }
        
        // ============================================================================
        // STEP 1: COLLECT ALL PATH WAYPOINTS (User waypoints + Obstacle detours)
        // ============================================================================
        // First, we need to build a complete list of waypoints that includes:
        // - Original user-placed control points
        // - Additional points from PathPlanner to navigate around obstacles
        
        let allWaypoints = [];
        const unitRadius = unit.collisionRadius || 1.5;
        
        if (this.pathPlanner && controlPoints.length >= 2) {
            for (let i = 0; i < controlPoints.length - 1; i++) {
                const segStart = controlPoints[i];
                const segEnd = controlPoints[i + 1];
                
                // Always add the start point
                allWaypoints.push(segStart.clone());
                
                // Check if this segment has obstacles
                if (this.pathPlanner.hasObstacle(segStart, segEnd)) {
                    // Get detour path from PathPlanner (A* around obstacles)
                    const detourPath = this.pathPlanner.refineSegment(segStart, segEnd, unitRadius);
                    
                    // SIMPLIFY detour: We don't need every A* grid point
                    // Keep only significant direction changes (Douglas-Peucker style)
                    // For now, sample every 5m along the detour
                    const minSpacing = 5.0;
                    let lastAdded = segStart;
                    
                    for (let j = 1; j < detourPath.length - 1; j++) {
                        const pt = detourPath[j];
                        if (pt.distanceTo(lastAdded) >= minSpacing) {
                            // NaN safety check
                            if (!isNaN(pt.x) && !isNaN(pt.y) && !isNaN(pt.z)) {
                                allWaypoints.push(pt.clone());
                                lastAdded = pt;
                            }
                        }
                    }
                }
                // End point is handled by next iteration (or final push)
            }
            
            // Add final control point
            const lastCP = controlPoints[controlPoints.length - 1];
            if (lastCP && !isNaN(lastCP.x)) {
                allWaypoints.push(lastCP.clone());
            }
            
            // Handle closed path: check segment from last to first
            if (unit.isPathClosed) {
                const lastWP = controlPoints[controlPoints.length - 1];
                const firstWP = controlPoints[0];
                
                if (this.pathPlanner.hasObstacle(lastWP, firstWP)) {
                    const detourPath = this.pathPlanner.refineSegment(lastWP, firstWP, unitRadius);
                    const minSpacing = 5.0;
                    let lastAdded = lastWP;
                    
                    for (let j = 1; j < detourPath.length - 1; j++) {
                        const pt = detourPath[j];
                        if (pt.distanceTo(lastAdded) >= minSpacing) {
                            if (!isNaN(pt.x) && !isNaN(pt.y) && !isNaN(pt.z)) {
                                allWaypoints.push(pt.clone());
                                lastAdded = pt;
                            }
                        }
                    }
                }
            }
        } else {
            // No PathPlanner - use raw control points
            allWaypoints = controlPoints.map(p => p.clone());
        }
        
        // ============================================================================
        // STEP 2: CALCULATE AUTOMATIC TANGENTS FOR EACH WAYPOINT
        // ============================================================================
        // For smooth C1 continuity, each waypoint needs:
        // - inTangent: direction arriving at this point
        // - outTangent: direction leaving this point
        // 
        // These must be COLLINEAR (on same line) for smooth curves.
        // 
        // Tangent direction = (nextPoint - prevPoint).normalize()
        // Tangent length = 40% of distance to respective neighbor
        // ============================================================================
        
        const waypointsWithTangents = [];
        const n = allWaypoints.length;
        const tangentScale = 0.35; // 35% of segment length (increased for smoother curves)
        
        for (let i = 0; i < n; i++) {
            const current = allWaypoints[i];
            
            // Determine neighbors (with wrap-around for closed paths)
            let prev, next;
            
            if (i === 0) {
                // FIRST POINT
                if (unit.isPathClosed) {
                    prev = allWaypoints[n - 1];
                    next = allWaypoints[1];
                } else {
                    // Open path: use direction TO next point (no prev)
                    prev = current; // Will be handled below
                    next = allWaypoints[Math.min(1, n - 1)];
                }
            } else if (i === n - 1) {
                // LAST POINT
                if (unit.isPathClosed) {
                    prev = allWaypoints[n - 2];
                    next = allWaypoints[0];
                } else {
                    // Open path: use direction FROM prev point (no next)
                    prev = allWaypoints[n - 2];
                    next = current; // Will be handled below
                }
            } else {
                prev = allWaypoints[i - 1];
                next = allWaypoints[i + 1];
            }
            
            // Calculate tangent DIRECTION (collinear for C1 continuity)
            // IMPORTANT: Use AVERAGE of NORMALIZED directions, NOT (next - prev)
            // This ensures distance doesn't affect tangent direction - only direction matters
            let tangentDir;
            
            if (prev === current && next !== current) {
                // First point of open path: use direction TO next
                tangentDir = next.clone().sub(current).normalize();
            } else if (next === current && prev !== current) {
                // Last point of open path: use direction FROM prev
                tangentDir = current.clone().sub(prev).normalize();
            } else if (prev === current && next === current) {
                // Degenerate case: single point path
                tangentDir = new THREE.Vector3(0, 0, 1);
            } else {
                // Normal case: AVERAGE of normalized directions (ignores distance)
                const dirFromPrev = current.clone().sub(prev).normalize();
                const dirToNext = next.clone().sub(current).normalize();
                tangentDir = dirFromPrev.add(dirToNext).normalize();
            }
            
            // Safety check for zero-length tangent
            if (tangentDir.lengthSq() < 0.001) {
                tangentDir.set(0, 0, 1);
            }
            
            // Calculate tangent LENGTHS (proportional to segment distances)
            // REDUCED to 25% to prevent loops and breaks
            const distToPrev = current.distanceTo(prev);
            const distToNext = current.distanceTo(next);
            
            // MAX TANGENT LENGTH to prevent self-crossing (loop prevention)
            const maxTangentLength = 10.0; // Increased for smoother curves at waypoints
            const inTangentLength = Math.min(distToPrev * tangentScale, maxTangentLength);
            const outTangentLength = Math.min(distToNext * tangentScale, maxTangentLength);
            
            // Calculate actual tangent vectors
            // inTangent points TOWARD this waypoint (from previous direction)
            // outTangent points AWAY from this waypoint (toward next)
            const inTangent = tangentDir.clone().multiplyScalar(-inTangentLength);
            const outTangent = tangentDir.clone().multiplyScalar(outTangentLength);
            
            waypointsWithTangents.push({
                position: current,
                inTangent: inTangent,   // Control point = position + inTangent
                outTangent: outTangent  // Control point = position + outTangent
            });
        }
        
        // ============================================================================
        // STEP 3: GENERATE CUBIC BEZIER CURVE SEGMENTS
        // ============================================================================
        // For each pair of waypoints, create a cubic Bezier segment:
        // 
        // P0 = start waypoint position
        // P1 = P0 + start.outTangent (control point 1)
        // P2 = P3 + end.inTangent (control point 2)
        // P3 = end waypoint position
        //
        // Cubic Bezier formula:
        // B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
        // ============================================================================
        
        const sampledPath = [];
        const sampleSpacing = 0.3; // Sample every 0.3 meters (denser = smoother visual)
        
        const numSegments = unit.isPathClosed ? n : n - 1;
        
        for (let i = 0; i < numSegments; i++) {
            const startIdx = i;
            const endIdx = (i + 1) % n;
            
            const start = waypointsWithTangents[startIdx];
            const end = waypointsWithTangents[endIdx];
            
            // Bezier control points
            const P0 = start.position;
            const P1 = P0.clone().add(start.outTangent);
            const P2 = end.position.clone().add(end.inTangent);
            const P3 = end.position;
            
            // Calculate segment length (approximate)
            const chordLength = P0.distanceTo(P3);
            const numSamples = Math.max(10, Math.ceil(chordLength / sampleSpacing));
            
            // Sample the Bezier curve
            for (let j = 0; j < numSamples; j++) {
                const t = j / numSamples;
                const oneMinusT = 1 - t;
                
                // Cubic Bezier formula
                // B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
                const point = P0.clone().multiplyScalar(oneMinusT * oneMinusT * oneMinusT)
                    .add(P1.clone().multiplyScalar(3 * oneMinusT * oneMinusT * t))
                    .add(P2.clone().multiplyScalar(3 * oneMinusT * t * t))
                    .add(P3.clone().multiplyScalar(t * t * t));
                
                sampledPath.push(point);
            }
        }
        
        // Add final point for open paths
        if (!unit.isPathClosed && waypointsWithTangents.length > 0) {
            sampledPath.push(waypointsWithTangents[n - 1].position.clone());
        }
        
        // ============================================================================
        // STEP 4: PROJECT ALL POINTS TO TERRAIN SURFACE
        // ============================================================================
        // Each sampled point needs to be placed on the actual terrain surface.
        // This ensures the unit follows hills and valleys correctly.
        // ============================================================================
        
        const projectedPoints = sampledPath.map(p => {
            const dir = p.clone().normalize();
            const terrainRadius = this.planet.terrain.getRadiusAt(dir);
            return dir.multiplyScalar(terrainRadius + groundOffset);
        });
        
        // ============================================================================
        // STEP 5: CREATE VISUALIZATION (TubeGeometry)
        // ============================================================================
        // The projected path is visualized as a thick tube for clarity.
        // CatmullRomCurve3 is used here ONLY for the visual tube, not for pathfinding.
        // ============================================================================
        
        const visualCurve = new THREE.CatmullRomCurve3(projectedPoints, unit.isPathClosed, 'catmullrom', 0.5);

        // Create/update THICK curve visualization
        if (unit.waypointCurveLine) {
            this.scene.remove(unit.waypointCurveLine);
            unit.waypointCurveLine.geometry.dispose();
            unit.waypointCurveLine.material.dispose();
        }

        const tubularSegments = Math.max(projectedPoints.length, projectedPoints.length * 1.5) | 0;
        const tubeGeo = new THREE.TubeGeometry(visualCurve, tubularSegments, 0.08, 12, unit.isPathClosed);
        const tubeMat = new THREE.MeshBasicMaterial({
            color: unit.isPathClosed ? 0x00ff88 : 0x00cc66,
            transparent: true,
            opacity: 0.6,
            depthTest: true,
            depthWrite: true
        });
        unit.waypointCurveLine = new THREE.Mesh(tubeGeo, tubeMat);
        this.scene.add(unit.waypointCurveLine);

        // === PATH SYNC - FORWARD-ONLY REJOIN (FIX BACKTRACKING BUG) ===
        // When path changes, find the unit's current position on the path
        // and ensure we target a point that is FORWARD (in movement direction)
        const newCPCount = controlPoints.length;

        if (newCPCount >= 2) {
            // Store new permanent path
            unit.path = projectedPoints.map(p => p.clone());

            // === PATH SEGMENT MAPPING ===
            // Store which path index corresponds to each control point
            unit.pathSegmentIndices = [];
            // === PATH SEGMENT MAPPING (PRECISE) ===
            // Find exact path index closest to each Control Point for accurate Arrival detection.
            unit.pathSegmentIndices = [];

            for (let i = 0; i < controlPoints.length; i++) {
                const cp = controlPoints[i];
                let bestIdx = 0;
                let bestDist = Infinity;

                // Brute force search is fast enough (path length ~300-1000)
                // Optimization: Start search from previous bestIdx?
                // But path might loop or double back. Safe to search all.
                for (let j = 0; j < unit.path.length; j++) {
                    // Compare squared distance for speed
                    const dSq = unit.path[j].distanceToSquared(cp);
                    if (dSq < bestDist) {
                        bestDist = dSq;
                        bestIdx = j;
                    }
                }
                unit.pathSegmentIndices.push(bestIdx);
            }

            const unitPos = unit.position.clone();

            // Get unit's forward direction (velocity or heading)
            let unitForward = new THREE.Vector3(0, 0, 1);
            if (unit.velocityDirection && unit.velocityDirection.lengthSq() > 0.01) {
                unitForward = unit.velocityDirection.clone().normalize();
            } else if (unit.headingQuaternion) {
                unitForward = new THREE.Vector3(0, 0, 1).applyQuaternion(unit.headingQuaternion);
            }
            
            // === PATH SYNC (LOGICAL SEGMENT-BASED) ===
            // Use targetWaypointId to determine which segment we're in (A→B)
            // Only search within that segment, never skip to further waypoints
            // This fixes the bug where dragging B behind unit causes it to skip B
            
            let segmentStart = 0;
            let segmentEnd = unit.path.length;
            
            // === MANDATORY PATH RE-PROJECTION ===
            // When path geometry changes (drag), the old unit.pathIndex is invalid (points to old array).
            // We MUST find where the unit is on the NEW path.
            
            if (unit.waypoints && unit.waypoints.length > 0) {
                 // 1. Determine Search Range (Current Logical Segment)
                 // This prevents jumping to other parts of the track (e.g. adjacent loops).
                 let searchStart = 0;
                 let searchEnd = unit.path.length;

                 if (unit.targetWaypointId && unit.lastWaypointId && unit.pathSegmentIndices) {
                     // Use ACTUAL lastWaypointId and targetWaypointId for segment search
                     const lastWPIndex = unit.waypoints.findIndex(wp => wp.id === unit.lastWaypointId);
                     const targetWPIndex = unit.waypoints.findIndex(wp => wp.id === unit.targetWaypointId);
                     
                     if (lastWPIndex !== -1 && targetWPIndex !== -1) {
                         // Get path indices for this segment
                         const idxA = unit.pathSegmentIndices[lastWPIndex] || 0;
                         const idxB = unit.pathSegmentIndices[targetWPIndex] || unit.path.length;
                         
                         // Handle Wrap-around or normal case
                         if (idxA < idxB) {
                             // Normal case: A before B
                             searchStart = Math.max(0, idxA);
                             searchEnd = Math.min(unit.path.length, idxB + 10);
                         } else {
                             // Wrapped segment (End -> Start in closed loop)
                             // Search from A to end, then from 0 to B
                             // For simplicity, search whole path but prefer forward direction
                             searchStart = 0;
                             searchEnd = unit.path.length;
                         }
                         
                         // console.log(`[SEGMENT] Searching between lastWp=${lastWPIndex} (pathIdx=${idxA}) and targetWp=${targetWPIndex} (pathIdx=${idxB})`);
                     }
                 }

                 // 2. Find Closest Point in Range
                 let bestIdx = searchStart;
                 let bestDist = Infinity;
                 
                 // Optimization: Step 1 vs Step 10? Dense path (0.5m) so Step 1 is fine.
                 for (let k = searchStart; k < searchEnd; k++) {
                     const dSq = unit.position.distanceToSquared(unit.path[k]);
                     if (dSq < bestDist) {
                         bestDist = dSq;
                         bestIdx = k;
                     }
                 }
                 
                 // 3. Forward Bias (Prevent "Stuck/Turn" Bug)
                 // If the best point is slightly behind, we might get stuck turning back.
                 // Prefer the next point if it's close enough.
                 // Simple hack: Just add +1 or +2 to index to "push" unit forward along the new curve.
                 const lookAhead = 2; // ~1 meter forward
                 let newIndex = bestIdx + lookAhead;
                 if (newIndex >= unit.path.length) newIndex = 0; // Wrap safe
                 
                 // Apply
                 unit.pathIndex = newIndex;
                 // console.log(`[PathRegen] Re-projected Unit to index ${newIndex} (was ${bestIdx})`);
            }

            // SEGMENT RESTRICTION: Only search within the current active segment
            // Use lastWaypointId and targetWaypointId for accurate segment bounds
            let startSearch = 0;
            let endSearch = unit.path.length;

            if (unit.targetWaypointId && unit.lastWaypointId && unit.pathSegmentIndices && unit.waypoints) {
                const lastWPIndex = unit.waypoints.findIndex(wp => wp.id === unit.lastWaypointId);
                const targetWPIndex = unit.waypoints.findIndex(wp => wp.id === unit.targetWaypointId);

                if (lastWPIndex !== -1 && targetWPIndex !== -1) {
                    const startPathIdx = unit.pathSegmentIndices[lastWPIndex] || 0;
                    const endPathIdx = unit.pathSegmentIndices[targetWPIndex] || unit.path.length;

                    if (startPathIdx <= endPathIdx) {
                        const buffer = 5;
                        startSearch = Math.max(0, startPathIdx);
                        endSearch = Math.min(unit.path.length, endPathIdx + buffer);
                    }
                    // For wrapped segments, keep full path search
                }
            }

            // Find the closest point within search range
            let closestIdx = startSearch;
            let closestDist = Infinity;

            for (let i = startSearch; i < endSearch; i++) {
                const d = unitPos.distanceTo(unit.path[i]);
                if (d < closestDist) {
                    closestDist = d;
                    closestIdx = i;
                }
            }

            // === FORWARD CHECK: Use closest point + small lookahead ===
            // Don't use large lookahead - it causes waypoint skipping when new points are added
            const minLookahead = 2; // Just 2 points ahead for smoothness
            let targetIdx = closestIdx + minLookahead;
            
            // Handle wrap/clamp
            if (targetIdx >= unit.path.length) {
                if (unit.isPathClosed) {
                    targetIdx = targetIdx % unit.path.length;
                } else {
                    targetIdx = unit.path.length - 1;
                }
            }

            unit.pathIndex = targetIdx;
            unit.isFollowingPath = true;

            // Clear savedPath to prevent keyboard override from restoring OLD path
            unit.savedPath = null;

            // === TRANSITION PATH GENERATION (User Requirement) ===
            // If the re-projected point is far away (e.g. dragged curve),
            // generate a safe path using PathPlanner to avoid obstacles (rocks/water).
            // THROTTLE: Only run every ~200ms (4 ticks at 20 ticks/sec) to prevent freezing during drag.
            // Uses tick-based throttle for determinism (Issue 6).
            const currentTick = this.simLoop?.tickCount || 0;
            if (this.pathPlanner && (!unit._lastTransitionCheckTick || currentTick - unit._lastTransitionCheckTick >= 4)) {
                unit._lastTransitionCheckTick = currentTick;
                
                const targetPoint = unit.path[unit.pathIndex];
                if (targetPoint) {
                    const distToTarget = unit.position.distanceTo(targetPoint);
                    const TRANSITION_THRESHOLD = 3.0; // Meters
                    
                    if (distToTarget > TRANSITION_THRESHOLD) {
                         // Check if we already have a valid transition path close to this target
                         let reusePath = false;
                         if (unit.transitionPath && unit.transitionPath.length > 0) {
                             const lastPt = unit.transitionPath[unit.transitionPath.length - 1];
                             if (lastPt.distanceToSquared(targetPoint) < 4.0) { // 2m tolerance for reuse
                                 reusePath = true; 
                             }
                         }
                         
                         if (!reusePath) {
                             // PLAN PATH (Sync but hierarchical - should be fast)
                             // Use generous radius to ensure clearance
                             const path = this.pathPlanner.planPath(unit.position, targetPoint, { margin: 1.5 });
                             if (path && path.length > 0) {
                                 unit.transitionPath = path;
                                 unit.transitionIndex = 0;
                                 unit.isInTransition = true;
                                 // console.log("[Transition] Generated path to re-join curve", path.length);
                             }
                         }
                    } else if (unit.isInTransition) {
                        // We are close enough to the main path, cancel transition
                        unit.isInTransition = false;
                        unit.transitionPath = null;
                    }
                }
            }
            unit.savedPathIndex = 0;
            unit.isKeyboardOverriding = false;

            if (this._isDevMode) console.log(`Path sync: closest=${closestIdx}, target=${targetIdx}`);
        }
    }

    /**
     * Create a geodesic (great-circle) path between two points on the sphere.
     * Used as fallback when A* fails.
     */
    _createGeodesicPath(start, end, numPoints) {
        const path = [];
        const startDir = start.clone().normalize();
        const endDir = end.clone().normalize();

        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            // Spherical linear interpolation (slerp)
            const dir = new THREE.Vector3().lerpVectors(startDir, endDir, t).normalize();
            const radius = this.planet.terrain.getRadiusAt(dir);
            path.push(dir.multiplyScalar(radius));
        }

        return path;
    }

    clearWaypointMarkers() {
        if (!this.selectedUnit) return;
        const unit = this.selectedUnit;

        if (unit.waypointMarkers) {
            unit.waypointMarkers.forEach(m => {
                // Remove label sprite if exists
                if (m.userData.labelSprite) {
                    this.scene.remove(m.userData.labelSprite);
                    m.userData.labelSprite.material.map.dispose();
                    m.userData.labelSprite.material.dispose();
                }
                this.scene.remove(m);
                m.geometry.dispose();
                m.material.dispose();
            });
            unit.waypointMarkers = [];
        }

        // Clear curve line
        if (unit.waypointCurveLine) {
            this.scene.remove(unit.waypointCurveLine);
            unit.waypointCurveLine.geometry.dispose();
            unit.waypointCurveLine.material.dispose();
            unit.waypointCurveLine = null;
        }

        // Clear control points
        unit.waypointControlPoints = [];
        unit.lastCommittedControlPointCount = 0;
        unit.passedControlPointCount = 0;
        unit.lastPassedControlPointID = null; // Reset ID tracking
        unit.loopingEnabled = false;
        unit.isPathClosed = false;
    }

    updateWaypointMarkerFill() {
        // User Request: "Minden egység folyamatosan frissíti... bármennyi unit esetén"
        // Iterate ALL units, not just selected.
        this.units.forEach(unit => {
            if (!unit) return;
            if (!unit.waypointMarkers || !unit.waypoints) return;
            if (unit.waypointMarkers.length === 0) return;
            if (unit.waypoints.length === 0) return;

            // === FALLBACK: Calculate IDs based on pathIndex if not set ===
            // === FALLBACK: Calculate IDs based on pathIndex if not set ===
            // DISABLED: This logic overrides strict ID sequencing based on spatial proximity!
            // When dragging, the path shape changes, and this logic might decide the unit is now
            // "closer" to a previous segment, resetting the target backward.
            // We TRUST the strict transition logic (Unit.js) and initial setup (Game.js).
            
            /*
            if (unit.pathSegmentIndices && unit.pathSegmentIndices.length > 0 && unit.waypoints.length > 1) {
                // ... (Logic removed to prevent "Order Chaos/Color Swap" bug) ...
            }
            */
            // === INITIAL FALLBACK: If still not set, use first two waypoints ===
            if (!unit.lastWaypointId && unit.waypoints.length > 0) {
                unit.lastWaypointId = unit.waypoints[0].id;
            }
            if (!unit.targetWaypointId && unit.waypoints.length > 1) {
                unit.targetWaypointId = unit.waypoints[1].id;
            }

            // Determine target waypoint index (Local to unit)
            // Logic is robust: Unit tracks IDs. Visuals reflect IDs.
            unit.waypointMarkers.forEach((marker, index) => {
                if (!marker.material) return;

                let color = 0x00ff88; // Default: Green
                let opacity = 0.5;

                // ID-BASED COLORING using marker's own attached ID
                const markerId = marker.userData.id;

                // DEBUG: Log first marker of first unit to see what's happening
                if (this._isDevMode && index === 0 && this.units.indexOf(unit) === 0) {
                    const mId = markerId ? markerId.slice(-4) : 'null';
                    const lId = unit.lastWaypointId ? unit.lastWaypointId.slice(-4) : 'null';
                    const tId = unit.targetWaypointId ? unit.targetWaypointId.slice(-4) : 'null';
                    console.log(`[COLOR DEBUG] markerId=${mId} lastId=${lId} targetId=${tId}`);
                }

                if (markerId && unit.targetWaypointId && markerId === unit.targetWaypointId) {
                    // ORANGE: Current Target (Goes to)
                    color = 0xffaa00;
                    opacity = 1.0;
                } else if (markerId && unit.lastWaypointId && markerId === unit.lastWaypointId) {
                    // BLUE: Previous Anchor (Left behind)
                    color = 0x00aaff;
                    opacity = 0.85;
                }

                // OPTIMIZATION: Only update if changed
                // "sok 10ezer unit" -> Performance is key.
                if (marker.userData.lastHex !== color || marker.userData.lastOpacity !== opacity) {
                    marker.material.color.setHex(color);
                    marker.material.opacity = opacity;

                    marker.userData.lastHex = color;
                    marker.userData.lastOpacity = opacity;
                }
            });
        });
        
        // DEBUG: Show pathfinding walkable/blocked nodes
        this.updatePathPlannerDebug();
    }

    handlePathLooping() {
        if (!this.selectedUnit) return;
        const unit = this.selectedUnit;

        if (!unit.waypointControlPoints || unit.waypointControlPoints.length < 3) return;
        if (!unit.loopingEnabled || !unit.isPathClosed) return;

        if (unit.path && unit.path.length === 0) {
            const allFilled = unit.waypointMarkers && unit.waypointMarkers.length > 0 &&
                unit.waypointMarkers.every(m => m.userData.isFilled);

            if (allFilled) {
                // Create Catmull-Rom curve through ALL control points
                const loopCurve = new THREE.CatmullRomCurve3(unit.waypointControlPoints, true, 'centripetal', 0.5);

                // Increase sample density for smooth terrain following
                const loopSamples = Math.max(100, unit.waypointControlPoints.length * 30);
                const loopPointsRaw = loopCurve.getPoints(loopSamples);

                // PROJECT onto terrain (CRITICAL FIX)
                const loopPoints = loopPointsRaw.map(p => {
                    const dir = p.clone().normalize();
                    const terrainRadius = this.planet.terrain.getRadiusAt(dir);
                    // Add slight offset like updateWaypointCurve
                    return dir.multiplyScalar(terrainRadius + 0.3);
                });

                unit.path = loopPoints;

                unit.waypointMarkers.forEach((marker, idx) => {
                    marker.userData.isFilled = false;
                    // NOTE: Colors are managed by updateWaypointMarkerFill - do not set here
                });
                unit.passedControlPointCount = 0;

                if (this._isDevMode) console.log("Path looping (Projected on Terrain)!");
            }
        }
    }

    startPathDrawing(unit) {
        // Phase 2A: Path drawing disabled in mirror mode (server controls movement)
        if (this._mirrorMode) return;

        // Direct Steering Start
        // Maybe show a line to cursor?
        if (this.pathLine) this.scene.add(this.pathLine);

        // Start Moving Slowly (User requirement: "lassan induljon el")
        if (unit) {
            unit.isFollowingPath = false; // Not following path yet (drawing)
            // But maybe we want it to creep forward?
            // "Ha a user vonalat kezd rajzolni, akkor a unit lassan induljon el rajta"
            // Start moving on existing path or just idle?
            // If dragging unit -> Path Draw. The unit shouldn't move while drawing?
            // "unit lassan induljon el rajta" -> implies it starts following the path being drawn?
            // Impossible if path isn't finished.
            // Maybe they mean: When I click play?

            // "Ha a user vonalat kezd rajzolni" -> Dragging from Unit?
            // If dragging from unit, we are designing the path.
            // Let's assume they mean: When path is valid, start moving.

            // Actually, "unit lassan induljon el rajta" might mean "Start moving towards the first waypoint as soon as it is placed"?
            // If I drag, I place waypoints.
            // If I place Waypoint 1, 2, 3... Unit should start moving to WP1 immediately?
            // Yes.

            unit.setCommandPause(false); // Unpause
            unit.isFollowingPath = true; // Try to follow whatever path exists
        }
    }

    updatePathDrawing(unit, hitPoint) {
        // DIRECT STEERING: Drive unit towards cursor
        if (unit && hitPoint) {
            unit.steerTowards(hitPoint);

            // Visuals: Line from Unit to Cursor
            const points = [unit.position.clone(), hitPoint.clone()];
            if (this.pathLine) {
                this.pathLine.geometry.setFromPoints(points);
            }
        }
    }

    finishPathDrawing(unit) {
        // Stop Steering
        if (unit) {
            unit.stopSteering();
        }

        // Clear visuals
        if (this.pathLine) {
            this.pathLine.geometry.setFromPoints([]);
        }
    }

    onUnitDoubleClicked(unit) {
        if (this._isDevMode) console.log("Double Clicked:", unit);
        if (unit) {
            this.enterFocusMode(unit);
        }
    }

    // === Focus Mode (Split Screen) ===

    enterFocusMode(unit) {
        const isNewUnit = (this.focusedUnit !== unit);

        // Note: We allow re-entry to ensure UI syncing if panel was closed or camera drifted
        this.isFocusMode = true;
        this.focusedUnit = unit;

        // Ensure unit is selected
        this.selectUnit(unit);

        // UI Transition
        document.body.classList.add('split-screen');

        // Camera Logic - SMOOTH TRANSITION to overhead view for path editing
        if (this.cameraControls) {
            // STOP CHASING - we want static view for path editing
            this.cameraControls.setChaseTarget(null);

            // Calculate target camera position (same as positionCameraAboveUnit)
            const unitPos = unit.position.clone();
            const up = unitPos.clone().normalize();
            const distance = 30;

            const tangent = new THREE.Vector3(1, 0, 0).cross(up).normalize();
            if (tangent.lengthSq() < 0.01) {
                tangent.set(0, 1, 0).cross(up).normalize();
            }

            const cameraOffset = up.clone().multiplyScalar(0.6)
                .add(tangent.clone().multiplyScalar(0.4))
                .normalize()
                .multiplyScalar(distance);

            const targetCameraPos = unitPos.clone().add(cameraOffset);

            // Build target orientation
            const lookMatrix = new THREE.Matrix4();
            lookMatrix.lookAt(targetCameraPos, unitPos, up);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookMatrix);

            // SMOOTH ANIMATION instead of instant jump
            // Use cameraControls internal smoothing by setting targets
            this.cameraControls.targetPosition.copy(targetCameraPos);
            this.cameraControls.targetQuaternion.copy(targetQuat);
            // Camera will smoothly interpolate with its built-in easing
        }

        // Ensure path visualization is VISIBLE when panel is open
        this.showUnitMarkers(unit);

        // Update Panel Content
        this.updatePanelContent(unit);

        // SHIFT VIEWPORT: Panel is ~38% of screen height
        // We shift the view UP so the unit is centered in the remaining space
        if (this.cameraControls) {
            this.cameraControls.setViewOffsetPixel(window.innerHeight * 0.38);
        }

        // NOTE: Removed resize trigger - map should not move when panel opens 
    }

    exitFocusMode() {
        if (!this.isFocusMode) return;

        this.isFocusMode = false;
        this.focusedUnit = null;

        // UI Transition
        document.body.classList.remove('split-screen');

        // NOTE: Removed resize trigger - map stays at full size

        // Restore Camera
        if (this.cameraControls) {
            // Stop chasing when exiting focus mode
            this.cameraControls.chaseTarget = null;
            // Reset Viewport
            this.cameraControls.setViewOffsetPixel(0);
        }
    }

    /**
     * Get the unit that should be shown in the panel.
     * Priority: focusedUnit > selectedUnit
     */
    getPanelUnit() {
        return this.focusedUnit || this.selectedUnit;
    }

    /**
     * Update the bottom panel content.
     * @param {Unit} [unitOverride] - Optional unit to show. If not provided, uses getPanelUnit().
     */
    updatePanelContent(unitOverride = null) {
        const unit = unitOverride || this.getPanelUnit();
        const panelContent = document.querySelector('#bottom-panel .panel-content');

        // DEBUG LOG
        if (this._isDevMode) {
            console.log('[Panel] updatePanelContent', {
                unit: (unit && unit.name) || 'NO UNIT',
                waypointControlPoints: (unit && unit.waypointControlPoints) ? unit.waypointControlPoints.length : 0,
                focusedUnit: (this.focusedUnit && this.focusedUnit.name) || 'none',
                selectedUnit: (this.selectedUnit && this.selectedUnit.name) || 'none',
                panelFound: !!panelContent
            });
        }

        // BLOCK UPDATES DURING DRAG to prevent DOM thrashing and killing the drag event
        if (this.isCommandQueueDragging) {
            return;
        }

        // If no unit or no panel, show placeholder
        if (!unit || !panelContent) {
            if (panelContent) {
                panelContent.innerHTML = '<div class="placeholder-text">Select a unit.</div>';
            }
            return;
        }

        if (panelContent) {
            // console.log('[Panel] panelContent found! Building HTML...');
            // Build Command Queue HTML from unit's waypoints
            let commandQueueHTML = '<div class="command-queue-list" id="command-queue-list">';

            if (unit.commands && unit.commands.length > 0) {
                let waypointCounter = 0;

                unit.commands.forEach((cmd, index) => {
                    // State Logic
                    // We need to know which command is "current"
                    // Unit.js needs to track currentCommandIndex
                    const isCurrent = (index === unit.currentCommandIndex);
                    const isCompleted = (index < unit.currentCommandIndex);
                    const isPending = (index > unit.currentCommandIndex);
                    
                    let stateClass = '';
                    if (isCompleted) stateClass = 'state-to'; // Reuse "To" style (Blue) -> maybe "Completed"?
                    if (isCurrent) stateClass = 'state-active'; // "Active" (Orange)
                    if (isPending) stateClass = ''; // Default
                    
                    if (cmd.type === 'Move') {
                        // MOVE CARD
                        // Only increment counter for Move commands to keep "Waypoint 0, 1, 2" logic consistent
                        const wpCount = waypointCounter++;
                        const label = `WAYPOINT ${wpCount}`;
                        
                        let coords = "0, 0, 0";
                        if (cmd.params.position) {
                            coords = `${cmd.params.position.x.toFixed(0)}, ${cmd.params.position.y.toFixed(0)}, ${cmd.params.position.z.toFixed(0)}`;
                        }
                        
                        const icon = isCurrent ? '🎯' : (isCompleted ? '🔙' : '📍');
                        
                        commandQueueHTML += `
                        <div class="command-item ${stateClass}" draggable="true" data-index="${index}" data-cmd-id="${cmd.id}">
                            <div class="cmd-icon">${icon}</div>
                            <div class="cmd-info">
                                <div class="cmd-type">MOVE TO</div>
                                <div class="cmd-coords">${label}</div>
                                <div class="cmd-details">${coords}</div>
                            </div>
                            <div class="cmd-actions">
                                <button class="cmd-action-btn delete-btn" title="Remove" data-index="${index}">✕</button>
                            </div>
                        </div>
                        `;
                    } else {
                        // ACTION CARD
                        const actionTypes = [
                                'Move To', 'Go', 'Climbs a rock', 'Digs a tunnel', 'Jumps', 'Flies over terrain', 
                                'Flies to another asteroid', 'Swims on water', 'Swims in water', 'Rolls on the waterbed',
                                'Mine Material', 'Build Wall', 'Build Road', 'Land leveling', 'Production', 'Load', 'Produce Power',
                                'Laser shot', 'Missile shot', 'Canon shot', 'Shell', 'Bomb',
                                'Freezes', 'Takes control', 'Slow down', 'Blinds', 'Block', 'Jam', 'Smoke', 
                                'Launches a drone', 'Building a minefield', 'Becomes invisible', 'Dig in', 'Projecting a unit',
                                'Wait'
                        ];

                        const optionsHTML = actionTypes.map(type => 
                            `<option value="${type}" ${cmd.type === type ? 'selected' : ''}>${type}</option>`
                        ).join('');
                        
                        let paramInputs = '';
                        if (cmd.type === 'Wait' || cmd.params.seconds !== undefined) {
                            const sec = cmd.params.seconds || 3.0;
                            paramInputs = `
                            <div class="action-seconds">
                                <input type="number" class="seconds-input" value="${sec}" min="0" step="0.5" data-index="${index}">
                                <span class="seconds-label">sec</span>
                            </div>`;
                        }

                        commandQueueHTML += `
                        <div class="command-item action-card ${stateClass}" draggable="true" data-index="${index}" data-cmd-id="${cmd.id}">
                            <div class="cmd-icon">⏱️</div>
                            <div class="cmd-info action-card-content">
                                <select class="action-dropdown" data-index="${index}">
                                    ${optionsHTML}
                                </select>
                                ${paramInputs}
                            </div>
                            <div class="cmd-actions">
                                <button class="cmd-action-btn delete-btn" title="Remove Action" data-index="${index}">✕</button>
                            </div>
                        </div>
                        `;
                    }
                });
            } else {
                commandQueueHTML += `
                    <div class="no-commands">
                        <div class="no-commands-icon">📋</div>
                        <div class="no-commands-text">No commands</div>
                        <div class="no-commands-hint">Shift+Click map or +Action</div>
                    </div>
                `;
            }

            commandQueueHTML += '</div>';

            // Calculate altitude
            const altitude = (unit.position.length() - this.planet.terrain.params.radius).toFixed(2);
            const isFollowing = unit.isFollowingPath && !unit.pausedByCommand;
            const statusClass = isFollowing ? 'active' : (unit.pausedByCommand ? 'paused' : 'stopped');
            const statusText = isFollowing ? 'Following' : (unit.pausedByCommand ? 'Paused' : 'Idle');

            // SVG Icons
            const playIcon = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
            const pauseIcon = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
            const currentIcon = unit.pausedByCommand ? playIcon : pauseIcon;

            panelContent.innerHTML = `
                <div class="panel-container">
                    <div class="unit-info">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h3 style="margin: 0;">Unit Status</h3>
                            <div class="unit-play-pause-btn ${unit.pausedByCommand ? 'paused' : 'playing'}" 
                                 onclick="window.game.toggleUnitPause()"
                                 title="${unit.pausedByCommand ? 'Resume' : 'Pause'}">
                                ${currentIcon}
                            </div>
                        </div>
                        <div class="stat-grid">
                            <div class="stat-item">
                                <div class="stat-label">Speed</div>
                                <div class="stat-value accent">${unit.speed.toFixed(1)}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Turn Rate</div>
                                <div class="stat-value">${unit.turnSpeed.toFixed(1)}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Altitude</div>
                                <div class="stat-value">${altitude}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Status</div>
                                <div class="stat-value">
                                    <span class="status-badge ${statusClass}">
                                        <span class="status-dot"></span>
                                        ${statusText}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="command-queue">
                        <h3>Command Queue</h3>
                        <div class="playback-controls">
                            <button class="ctrl-btn primary" id="play-btn">▶ Play</button>
                            <button class="ctrl-btn" id="pause-btn">⏸ Pause</button>
                            <button class="ctrl-btn danger" id="clear-btn">✕ Clear</button>
                            <button class="ctrl-btn action-btn" id="add-action-btn">+ Action</button>
                        </div>
                        ${commandQueueHTML}
                        <p class="hint-text"><kbd>Shift</kbd> + <kbd>Click</kbd> to add waypoints</p>
                    </div>
                </div>
            `;

            // Setup drag reorder listeners (must run every time - innerHTML overwrites DOM)
            this.setupCommandQueueDragListeners();

            // Setup playback button listeners
            this.setupPlaybackButtons();
        }
    }

    setupCommandQueueDragListeners() {
        const list = document.getElementById('command-queue-list');
        if (!list) return;

        let draggedItem = null;
        let dragStartOrder = null;

        const items = list.querySelectorAll('.command-item'); // Select ALL items

        // Enable drop on the list container itself
        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        items.forEach((item) => {
            item.addEventListener('dragstart', (e) => {
                this.isCommandQueueDragging = true; // LOCK UPDATES
                draggedItem = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                // Store original order to compare later
                dragStartOrder = Array.from(list.querySelectorAll('.command-item')).map(i => i.dataset.index);
            });

            item.addEventListener('dragend', () => {
                this.isCommandQueueDragging = false; // UNLOCK UPDATES
                item.classList.remove('dragging');

                // Check if order changed
                const newOrder = Array.from(list.querySelectorAll('.command-item')).map(i => i.dataset.index);
                const orderChanged = JSON.stringify(dragStartOrder) !== JSON.stringify(newOrder);

                if (orderChanged) {
                    // Order changed - apply to game logic
                    this.reorderCommandsFromDOM();
                }

                draggedItem = null;
                dragStartOrder = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedItem && draggedItem !== item) {
                    const rect = item.getBoundingClientRect();
                    // Horizontal layout: compare X position
                    const midX = rect.left + rect.width / 2;
                    if (e.clientX < midX) {
                        item.parentNode.insertBefore(draggedItem, item);
                    } else {
                        item.parentNode.insertBefore(draggedItem, item.nextSibling);
                    }
                }
            });
        });

        // === DELETE BUTTON HANDLERS ===
        const deleteButtons = list.querySelectorAll('.delete-btn');
        deleteButtons.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // M07: Gate by seat authority
                if (!this._hasPanelSeatAuthority()) {
                    if (this._isDevMode) console.warn('[UI] Cannot delete command: not seated on unit');
                    return;
                }

                const index = parseInt(btn.dataset.index);
                if (this._isDevMode) console.log(`[UI] Delete command at index ${index}`);
                this.deleteCommandAtIndex(index);
            });
        });

        // === ACTION DROPDOWN HANDLER ===
        const dropdowns = list.querySelectorAll('.action-dropdown');
        dropdowns.forEach((dd) => {
            dd.addEventListener('change', (e) => {
                // M07: Gate by seat authority
                if (!this._hasPanelSeatAuthority()) {
                    if (this._isDevMode) console.warn('[UI] Cannot change command: not seated on unit');
                    return;
                }

                const index = parseInt(dd.dataset.index);
                const newType = e.target.value;
                if (this.selectedUnit && this.selectedUnit.commands[index]) {
                    this.selectedUnit.commands[index].type = newType;
                    // Auto-sync if type structure changes (e.g. Move vs Wait), but here mostly types are compatible
                }
            });
        });

        // === SECONDS INPUT HANDLER ===
        const inputs = list.querySelectorAll('.seconds-input');
        inputs.forEach((inp) => {
            inp.addEventListener('change', (e) => {
                // M07: Gate by seat authority
                if (!this._hasPanelSeatAuthority()) {
                    if (this._isDevMode) console.warn('[UI] Cannot change seconds: not seated on unit');
                    return;
                }

                const index = parseInt(inp.dataset.index);
                const val = parseFloat(e.target.value);
                if (this.selectedUnit && this.selectedUnit.commands[index]) {
                     if (!this.selectedUnit.commands[index].params) this.selectedUnit.commands[index].params = {};
                     this.selectedUnit.commands[index].params.seconds = val;
                }
            });
        });
    }

    /**
     * M07: Check if local client has seat authority on the panel unit.
     * Used to gate UI panel modifications.
     * @returns {boolean}
     * @private
     */
    _hasPanelSeatAuthority() {
        const unit = this.getPanelUnit();
        if (!unit) return false;
        return this.sessionManager?.hasSeatedUnit?.(unit) ?? true;
    }

    reorderCommandsFromDOM() {
        // M07: Gate by seat authority
        if (!this._hasPanelSeatAuthority()) {
            if (this._isDevMode) console.warn('[Game] Cannot reorder commands: not seated on unit');
            return;
        }

        const list = document.getElementById('command-queue-list');
        const unit = this.selectedUnit;
        if (!list || !unit || !unit.commands) return;

        const items = list.querySelectorAll('.command-item');
        const newOrderIndices = Array.from(items).map(item => parseInt(item.dataset.index));

        // Reorder COMMANDS
        const reorderedCommands = newOrderIndices.map(i => unit.commands[i]);
        unit.commands = reorderedCommands;

        // Adjust currentCommandIndex if necessary?
        // For simple logic, maybe reset or try to track the active one via ID?
        // Let's assume simpler: Reset logic or trust the user knows what they are doing.
        // Sync Derived Waypoints
        this.syncWaypointsFromCommands(unit);

        // Update panel to reflect new indices
        if (this.focusedUnit) {
            this.updatePanelContent(this.focusedUnit);
        }

        if (this._isDevMode) console.log("Commands reordered successfully.", newOrderIndices);
    }

    clearWaypoints() {
        // M07: Gate by seat authority
        if (!this._hasPanelSeatAuthority()) {
            if (this._isDevMode) console.warn('[Game] Cannot clear waypoints: not seated on unit');
            return;
        }

        const unit = this.getPanelUnit();
        if (!unit) {
            if (this._isDevMode) console.log("[Game] clearWaypoints: No unit");
            return;
        }

        this.clearWaypointMarkers(); // Clears markers and resets waypoints/controlPoints arrays on unit
        unit.path = [];
        unit.setCommandPause(false);
        // Bug #13 fix: Set isFollowingPath AFTER setCommandPause to prevent
        // setCommandPause(false) from re-enabling it ([] is truthy in JS)
        unit.isFollowingPath = false;
        unit.isKeyboardOverriding = false;
        unit.waterState = 'normal';
        // Bug #13 fix: Re-align headingQuaternion to current mesh orientation
        // so keyboard control responds to the unit's visual forward direction
        if (unit.headingQuaternion && unit.mesh) {
            unit.headingQuaternion.copy(unit.mesh.quaternion);
        }

        // === Bug #19 Fix: Clear ALL backing data structures ===
        // Without this, old commands/waypoints survive and ghost-reappear on next addCommand
        unit.commands = [];
        unit.currentCommandIndex = 0;
        unit.lastCompletedCommandIndex = -1;
        unit.waypoints = [];
        unit.targetWaypointId = null;
        unit.lastWaypointId = null;
        unit.pathSegmentIndices = [];
        unit.currentSegmentIndex = 0;
        unit.segmentProgress = 0.0;
        unit.lastControlPointIds = [];

        // Remove curve line
        if (unit.waypointCurveLine) {
            this.scene.remove(unit.waypointCurveLine);
            unit.waypointCurveLine.geometry.dispose();
            unit.waypointCurveLine = null;
        }

        // Update panel (no argument needed - will use getPanelUnit)
        this.updatePanelContent();
        if (this._isDevMode) console.log("[Game] Waypoints cleared via UI");
    }

    /**
     * Delete a single waypoint at the given index.
     * Removes control point, waypoint data, and marker.
     * Regenerates the path curve after deletion.
     * M07: Gated by seat authority (checked by caller)
     */
    deleteCommandAtIndex(index) {
        // M07: Gate by seat authority
        if (!this._hasPanelSeatAuthority()) {
            if (this._isDevMode) console.warn('[Game] Cannot delete command: not seated on unit');
            return;
        }

        const unit = this.getPanelUnit();
        if (!unit || !unit.commands) return;

        // Remove command
        unit.commands.splice(index, 1);

        // Adjust current index if needed
        if (unit.currentCommandIndex > index) unit.currentCommandIndex--;

        // Sync derived data
        this.syncWaypointsFromCommands(unit);

        // Update UI
        this.updatePanelContent();
        if (this._isDevMode) console.log(`[Game] Deleted command at index ${index}. Remaining: ${unit.commands.length}`);
    }
    setupPlaybackButtons() {
        // Clone buttons to remove all existing listeners (prevents duplication)
        const playBtnOld = document.getElementById('play-btn');
        const pauseBtnOld = document.getElementById('pause-btn');
        const clearBtnOld = document.getElementById('clear-btn');

        // Replace with clones to remove old listeners
        const playBtn = playBtnOld ? playBtnOld.cloneNode(true) : null;
        const pauseBtn = pauseBtnOld ? pauseBtnOld.cloneNode(true) : null;
        const clearBtn = clearBtnOld ? clearBtnOld.cloneNode(true) : null;

        if (playBtnOld && playBtn) playBtnOld.replaceWith(playBtn);
        if (pauseBtnOld && pauseBtn) pauseBtnOld.replaceWith(pauseBtn);
        if (clearBtnOld && clearBtn) clearBtnOld.replaceWith(clearBtn);

        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._isDevMode) console.log("[UI] Play button clicked");
                
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit && unit.waypointControlPoints && unit.waypointControlPoints.length >= 2) {
                    // Check if unit was already following BEFORE we change state
                    const wasAlreadyFollowing = unit.isFollowingPath && unit.pathIndex !== undefined && unit.pathIndex >= 0;

                    // Reset command pause
                    unit.setCommandPause(false);

                    // CRITICAL: Reset water state so unit can move again
                    unit.waterState = 'normal';

                    // Clear keyboard override state
                    unit.isKeyboardOverriding = false;

                    // If unit was manually driven off path, use smooth Bezier rejoin
                    if (unit.savedPath && unit.savedPath.length > 0) {
                        // Restore saved path as the active path
                        unit.path = unit.savedPath;
                        unit.savedPath = null;

                        // Find the closest FORWARD point on the restored path
                        const searchStart = Math.max(0, unit.savedPathIndex || 0);
                        const pathLen = unit.path.length;
                        let bestIdx = searchStart;
                        let bestDist = Infinity;
                        const maxSearch = unit.isPathClosed ? pathLen : (pathLen - searchStart);

                        for (let i = 0; i < maxSearch; i++) {
                            const idx = (searchStart + i) % pathLen;
                            if (!unit.isPathClosed && idx < searchStart) break;
                            const dist = unit.position.distanceTo(unit.path[idx]);
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestIdx = idx;
                            }
                            if (dist > bestDist * 2.0 && i > 6) break;
                        }

                        // Add lookahead based on distance
                        let rejoinIdx;
                        if (bestDist < 3.0) {
                            rejoinIdx = bestIdx + 6;
                        } else {
                            rejoinIdx = bestIdx + 12;
                        }

                        if (unit.isPathClosed || unit.loopingEnabled) {
                            rejoinIdx = rejoinIdx % pathLen;
                        } else {
                            rejoinIdx = Math.min(rejoinIdx, pathLen - 1);
                        }

                        unit.pathIndex = rejoinIdx;
                        unit.isFollowingPath = true;
                        unit.savedPathIndex = 0;

                        // Generate smooth Bezier transition arc
                        unit._generateRejoinArc(rejoinIdx);

                        if (this._isDevMode) console.log(`[UI] Play: Smooth rejoin via Bezier arc to idx ${rejoinIdx}`);
                    } else {
                        // Normal resume - clear any stale transition arc
                        if (unit.isInTransition) {
                            unit.isInTransition = false;
                            unit.transitionPath = null;
                            unit.transitionIndex = 0;
                        }

                        // Resume path following
                        unit.isFollowingPath = true;

                        // Only find closest point if starting fresh (not resuming from pause)
                        if (!wasAlreadyFollowing && unit.path && unit.path.length > 0) {
                            let closest = 0;
                            let minDist = Infinity;
                            for (let i = 0; i < unit.path.length; i++) {
                                const d = unit.position.distanceTo(unit.path[i]);
                                if (d < minDist) { minDist = d; closest = i; }
                            }
                            unit.pathIndex = closest;
                            if (this._isDevMode) console.log("[UI] Play: Found closest path point:", closest);
                        }

                        if (this._isDevMode) console.log("[UI] Playback: PLAY - Resumed path following");
                    }
                } else {
                    if (this._isDevMode) console.log("[UI] Play: No unit or insufficient waypoints");
                }
            });
        }

        if (pauseBtn) {
            pauseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._isDevMode) console.log("[UI] Pause button clicked");
                
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit) {
                    unit.setCommandPause(true);
                    if (this._isDevMode) console.log("[UI] Playback: PAUSE (Command)");
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._isDevMode) console.log("[UI] Clear button clicked");
                
                this.clearWaypoints();
            });
        }

        // === ADD ACTION BUTTON ===
        const addActionBtnOld = document.getElementById('add-action-btn');
        const addActionBtn = addActionBtnOld ? addActionBtnOld.cloneNode(true) : null;
        if (addActionBtnOld && addActionBtn) addActionBtnOld.replaceWith(addActionBtn);

        if (addActionBtn) {
            addActionBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._isDevMode) console.log("[UI] Add Action button clicked");
                
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit) {
                     this.addCommand(unit, 'Wait', { seconds: 3.0 });
                }
            });
        }


        // === ACTION CARD EVENT LISTENERS ===
        // Dropdown change
        document.querySelectorAll('.action-dropdown').forEach(dropdown => {
            dropdown.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.actionIndex);
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit && unit.actionCards && unit.actionCards[index]) {
                    unit.actionCards[index].type = e.target.value;
                    if (this._isDevMode) console.log(`[UI] Action ${index} type changed to: ${e.target.value}`);
                }
            });
        });

        // Seconds input change
        document.querySelectorAll('.seconds-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.actionIndex);
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit && unit.actionCards && unit.actionCards[index]) {
                    unit.actionCards[index].seconds = parseFloat(e.target.value) || 0;
                    if (this._isDevMode) console.log(`[UI] Action ${index} seconds changed to: ${e.target.value}`);
                }
            });
        });

        // Delete action button
        document.querySelectorAll('.delete-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const index = parseInt(e.target.dataset.actionIndex);
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit && unit.actionCards) {
                    unit.actionCards.splice(index, 1);
                    if (this._isDevMode) console.log(`[UI] Action ${index} deleted`);
                    this.updatePanelContent();
                }
            });
        });
    }


    updatePathVisuals() {
        if (this.currentPath.length > 0) {
            this.pathGeometry.setFromPoints(this.currentPath);
        } else if (this.selectedUnit && this.selectedUnit.path && this.selectedUnit.path.length > 0) {
            // Show unit's path
            this.pathGeometry.setFromPoints(this.selectedUnit.path);
        } else {
            // Clear
            this.pathGeometry.setFromPoints([]);
        }
    }

    /**
     * Position camera above a unit with a combined side/top view.
     */
    positionCameraAboveUnit(unit) {
        const unitPos = unit.position.clone();
        const up = unitPos.clone().normalize();

        // Camera distance from unit
        const distance = 30;

        // Position above and slightly to the side
        // Mix of "up" (radial) and a tangent direction for side view
        const tangent = new THREE.Vector3(1, 0, 0).cross(up).normalize();
        if (tangent.lengthSq() < 0.01) {
            tangent.set(0, 1, 0).cross(up).normalize();
        }

        // 60% up, 40% side for combined view
        const cameraOffset = up.clone().multiplyScalar(0.6)
            .add(tangent.clone().multiplyScalar(0.4))
            .normalize()
            .multiplyScalar(distance);

        const cameraPos = unitPos.clone().add(cameraOffset);

        // Set camera position
        this.camera.position.copy(cameraPos);

        // Look at the unit
        const lookMatrix = new THREE.Matrix4();
        lookMatrix.lookAt(cameraPos, unitPos, up);
        this.camera.quaternion.setFromRotationMatrix(lookMatrix);

        // Sync camera controller targets
        this.cameraControls.targetPosition.copy(cameraPos);
        this.cameraControls.targetQuaternion.copy(this.camera.quaternion);
    }

    start() {
        // Initialize Audio Manager with camera
        if (this.audioManager) {
            this.audioManager.init(this.camera);
        }

        this.animate();
        // Preloader fade is handled by Main.js onFirstRender callback
    }

    onWindowResize() {
        const width = window.innerWidth;
        // Always use full height - panel is overlay, doesn't affect canvas
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * R001: Fixed-timestep simulation tick (50ms).
     * All sim state mutations (unit positions, path logic) happen here.
     * @param {number} fixedDt - Fixed delta time in seconds (0.050)
     * @param {number} tickCount - Current tick number
     */
    simTick(fixedDt, tickCount) {
        // Phase 2A: Mirror mode — skip local simulation, render from SnapshotBuffer
        if (this._mirrorMode) {
            this._mirrorModeSimTick(tickCount);
            return;
        }

        // R006: Process input commands from queue first
        this._processInputCommands(tickCount);

        const keys = this.input.getKeys();

        // Update all units on fixed timestep
        this.units.forEach(unit => {
            if (!unit) return;

            // R008: Snapshot PREV state BEFORE update (for render interpolation)
            unit.snapshotPrevAuthState();

            // Sync params
            unit.speed = this.unitParams.speed;
            unit.turnSpeed = this.unitParams.turnSpeed;
            unit.groundOffset = this.unitParams.groundOffset;
            unit.smoothingRadius = this.unitParams.smoothingRadius;

            if (unit === this.selectedUnit) {
                // M07 GAP-0: Gate keyboard movement by seat authority
                // If client doesn't have seat, don't pass keyboard input
                const hasSeat = this.sessionManager?.hasSeatedUnit?.(unit) ?? true;
                const effectiveKeys = hasSeat ? keys : { forward: false, backward: false, left: false, right: false };
                unit.update(effectiveKeys, fixedDt, this.pathPlanner);
            } else {
                unit.update({ forward: false, backward: false, left: false, right: false }, fixedDt, this.pathPlanner);
            }

            // R008: Snapshot CURR state AFTER update (for render interpolation)
            unit.snapshotCurrAuthState();
        });

        // Unit-to-unit collision (mutual bounce)
        const activeUnits = this.units.filter(u => u);
        for (const unit of activeUnits) {
            unit.checkUnitCollisions(activeUnits);
        }

        // Handle path looping (sim state mutation)
        this.handlePathLooping();

        // Slice 2: Periodic state hash sampling for determinism verification
        if (tickCount % 60 === 0 && this.sessionManager?.getRole?.() !== 'OFFLINE') {
            const surface = this.stateSurface?.serialize?.();
            if (surface) {
                const hash = hashState(surface);
                if (this._isDevMode) {
                    console.log(`[Game] StateHash @tick ${tickCount}: ${hash.substring(0, 40)}...`);
                }
                // Store for debug evidence
                this._lastStateHash = hash;
                this._lastStateHashTick = tickCount;
            }
        }

        // R013: Periodic sync diagnostics (every 5 seconds = 100 ticks)
        if (tickCount % 100 === 0 && this.sessionManager?.getRole?.() !== 'OFFLINE') {
            const smCounters = this.sessionManager?._debugCounters;
            const role = this.sessionManager.getRole();
            console.log(`[SYNC] tick=${tickCount} role=${role} posSent=${smCounters?.positionSyncSentCount||0} posRecv=${smCounters?.positionSyncRecvCount||0} cmdSent=${smCounters?.batchSentCount||0} cmdRecv=${smCounters?.batchRecvCount||0}`);

            // On-screen sync indicator (visible without opening console)
            this._updateSyncHUD(role, smCounters, tickCount);
        }

        // R013 Slice 2: Broadcast buffered commands to other clients
        if (this.sessionManager?.sendCmdBatch) {
            this.sessionManager.sendCmdBatch();
        }

        // R013: Position sync - Host broadcasts unit positions every 3 ticks (150ms)
        // This syncs keyboard-driven movement (WASD) which doesn't flow through commands
        if (tickCount % 3 === 0 && this.sessionManager?.sendPositionSync) {
            this.sessionManager.sendPositionSync();
        }
    }

    /**
     * Phase 2A: Mirror mode sim tick — replaces normal simTick when server-authoritative.
     * Does NOT call Unit.update(). Instead reads from SnapshotBuffer and sets interpolation targets.
     * @param {number} tickCount - Current tick number
     */
    _mirrorModeSimTick(tickCount) {
        // 1. Get interpolation pair from SnapshotBuffer
        const pair = this._snapshotBuffer.getInterpolationPair();
        if (!pair.prev || !pair.next) return; // No snapshots yet

        // 2. Apply snapshot positions to unit interpolation targets
        const prevUnits = new Map();
        for (const u of pair.prev.units) prevUnits.set(u.id, u);
        const nextUnits = new Map();
        for (const u of pair.next.units) nextUnits.set(u.id, u);

        for (const unit of this.units) {
            if (!unit) continue;

            const prevU = prevUnits.get(unit.id);
            const nextU = nextUnits.get(unit.id);
            if (!nextU) continue; // Unit not in server snapshot

            const isTeleport = pair.teleports.has(unit.id);

            if (isTeleport || !prevU) {
                // Teleport or new unit: snap instantly
                unit._interpPrevPos.set(nextU.px, nextU.py, nextU.pz);
                unit._interpCurrPos.set(nextU.px, nextU.py, nextU.pz);
                unit.position.set(nextU.px, nextU.py, nextU.pz);
            } else {
                // Normal interpolation targets
                unit._interpPrevPos.set(prevU.px, prevU.py, prevU.pz);
                unit._interpCurrPos.set(nextU.px, nextU.py, nextU.pz);
                // Update authoritative position to latest for other systems (FOW, etc.)
                unit.position.set(nextU.px, nextU.py, nextU.pz);
            }

            // Phase 2A: Apply orientation quaternion from server snapshot
            // Server sends qx/qy/qz/qw aligned to terrain normal + heading direction.
            // Client applies directly — no local terrain fixup (prevents vibration).
            if (nextU.qw !== undefined && unit.mesh) {
                if (isTeleport || !prevU || prevU.qw === undefined) {
                    // Snap quaternion (teleport or first frame)
                    unit._interpPrevQuat.set(nextU.qx, nextU.qy, nextU.qz, nextU.qw);
                    unit._interpCurrQuat.set(nextU.qx, nextU.qy, nextU.qz, nextU.qw);
                } else {
                    // Smooth interpolation between prev and next quaternions
                    unit._interpPrevQuat.set(prevU.qx, prevU.qy, prevU.qz, prevU.qw);
                    unit._interpCurrQuat.set(nextU.qx, nextU.qy, nextU.qz, nextU.qw);
                }

                // Keep headingQuaternion in sync (used by camera, tire tracks, etc.)
                if (!unit.headingQuaternion) {
                    unit.headingQuaternion = unit.mesh.quaternion.clone();
                }
                unit.headingQuaternion.set(nextU.qx, nextU.qy, nextU.qz, nextU.qw);
            } else if (!unit.headingQuaternion && unit.mesh) {
                // Fallback for snapshots without quaternion data
                unit.headingQuaternion = unit.mesh.quaternion.clone();
            }

            unit._interpInitialized = true;
        }

        // 2b. Reconcile: create visual shells for server units missing locally
        for (const [id, snapUnit] of nextUnits) {
            if (!this.units.some(u => u && u.id === id)) {
                this._createVisualShellFromSnapshot(snapUnit);
            }
        }

        // 3. Send MOVE_INPUT at ~20Hz with latching
        const now = performance.now();
        if (now - this._lastMoveInputSendMs >= this._MOVE_INPUT_INTERVAL_MS) {
            this._lastMoveInputSendMs = now;

            const currentKeys = this.input.getKeys();
            const keys = {
                forward: this._latchedKeys.forward || currentKeys.forward,
                backward: this._latchedKeys.backward || currentKeys.backward,
                left: this._latchedKeys.left || currentKeys.left,
                right: this._latchedKeys.right || currentKeys.right
            };

            // Clear latches after sampling
            this._latchedKeys.forward = false;
            this._latchedKeys.backward = false;
            this._latchedKeys.left = false;
            this._latchedKeys.right = false;

            // Only send if any key is pressed (save bandwidth)
            if (keys.forward || keys.backward || keys.left || keys.right) {
                if (this.sessionManager?.sendMoveInput) {
                    this.sessionManager.sendMoveInput(keys, this.selectedUnit?.id);
                }
            }
        }

        // 4. Suppress Phase 1 POSITION_SYNC (do NOT call sendPositionSync in mirror mode)
        // This is already handled by the early return at the top of simTick()
    }

    /**
     * R008: Apply interpolated positions to all units for smooth rendering.
     * Called by SimLoop.onRender after sim ticks, at 60fps.
     * This is RENDER-ONLY and does NOT mutate authoritative sim state.
     *
     * @param {number} alpha - Interpolation factor [0, 1] from SimLoop accumulator
     */
    _applyInterpolatedRender(alpha) {
        this.units.forEach(unit => {
            if (!unit) return;
            unit.applyInterpolatedRender(alpha);
        });
    }

    /**
     * R011: Dev-only save/load with clickable HUD buttons.
     * Primary: Click [Save] / [Load] buttons in HUD
     * Keyboard: Ctrl+Shift+K = Save, Ctrl+Shift+J = Load
     * Only active when ?dev=1 or #dev=1 is present.
     */
    _setupDevSaveLoad() {
        // R012: Guard - only run in dev mode (panel created by initNetworkDebugPanel)
        if (!this._isDevMode || !this.networkDebugPanel) return;

        // Use unified panel buttons (created by NetworkDebugPanel)
        const btnSave = this.networkDebugPanel.btnSave;
        const btnLoad = this.networkDebugPanel.btnLoad;
        if (!btnSave || !btnLoad) return;

        // Update status uses unified HUD method
        const showStatus = (msg, isError = false) => {
            this._updateDBStatus(msg, isError);
        };

        // Create adapter wrapper for SaveManager (maps to global functions)
        const gameAdapter = {
            simLoop: this.simLoop,
            get units() { return this._gameRef.units; },
            set units(v) { /* no-op: we update in-place */ },
            get selectedUnit() { return this._gameRef.selectedUnit; },
            set selectedUnit(unit) {
                // Safely restore selection via Game's API (skipCamera=true during load)
                if (unit) {
                    this._gameRef.selectUnit(unit, true);
                } else {
                    this._gameRef.deselectUnit();
                }
            },
            _gameRef: this,
            rng: {
                getState: () => getGlobalRNG().getState(),
                setState: (s) => getGlobalRNG().setState(s)
            },
            idGenerator: {
                peekEntityId: () => peekEntityId(),
                setEntityIdCounter: (v) => setEntityIdCounter(v)
            },
            restoreUnits: (unitDataArray) => this._restoreUnitsFromSave(unitDataArray)
        };

        // R012: Choose storage adapter based on transport mode
        const useSupabase = !!this._supabaseClient;
        let storageAdapter = null;
        let saveManager = null;

        const getStorageAdapter = () => {
            if (!storageAdapter) {
                if (useSupabase) {
                    storageAdapter = new SupabaseStorageAdapter(this._supabaseClient);
                    console.log('[R012] Using SupabaseStorageAdapter for persistence');
                } else {
                    storageAdapter = new LocalStorageAdapter();
                    console.log('[R011] Using LocalStorageAdapter for persistence');
                }
            }
            return storageAdapter;
        };

        const getSaveManager = () => {
            if (!saveManager) {
                saveManager = new SaveManager(gameAdapter, getStorageAdapter());
            }
            return saveManager;
        };

        // Save action (async for Supabase)
        const doSave = async () => {
            showStatus('SAVING...', false);
            const mgr = getSaveManager();

            try {
                const result = useSupabase
                    ? await mgr.saveAsync('quicksave')
                    : mgr.save('quicksave');

                if (result.success) {
                    const tick = this.simLoop.tickCount;
                    // Estimate size from state (localStorage not available for Supabase)
                    const stateJson = JSON.stringify(result.data || {});
                    const bytes = stateJson.length;
                    const kb = (bytes / 1024).toFixed(1);
                    const backend = useSupabase ? 'CLOUD' : 'LOCAL';
                    showStatus(`SAVE OK t:${tick} ${kb}KB [${backend}]`);
                    console.log(`[R012] Saved at tick ${tick} (${kb}KB) via ${backend}`);
                } else {
                    showStatus(`SAVE FAIL: ${result.error}`, true);
                    console.error(`[R012] Save failed: ${result.error}`);
                }
            } catch (err) {
                showStatus(`SAVE ERR: ${err.message}`, true);
                console.error(`[R012] Save exception:`, err);
            }
        };

        // Load action (async for Supabase)
        const doLoad = async () => {
            showStatus('LOADING...', false);
            const mgr = getSaveManager();

            try {
                const result = useSupabase
                    ? await mgr.loadAsync('quicksave')
                    : mgr.load('quicksave');

                if (result.success) {
                    const tick = this.simLoop.tickCount;
                    const stateJson = JSON.stringify(result.data || {});
                    const bytes = stateJson.length;
                    const kb = (bytes / 1024).toFixed(1);
                    const backend = useSupabase ? 'CLOUD' : 'LOCAL';
                    showStatus(`LOAD OK t:${tick} ${kb}KB [${backend}]`);
                    console.log(`[R012] Loaded at tick ${tick} (${kb}KB) via ${backend}`);
                } else {
                    showStatus(`LOAD FAIL: ${result.error}`, true);
                    console.error(`[R012] Load failed: ${result.error}`);
                }
            } catch (err) {
                showStatus(`LOAD ERR: ${err.message}`, true);
                console.error(`[R012] Load exception:`, err);
            }
        };

        // Button click handlers
        btnSave.addEventListener('click', (e) => {
            e.stopPropagation();
            doSave();
        });
        btnLoad.addEventListener('click', (e) => {
            e.stopPropagation();
            doLoad();
        });

        // Window-level keyboard handler
        window.addEventListener('keydown', (e) => {
            // Don't intercept keys when typing in input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // ESC = Deselect current unit
            if (e.key === 'Escape') {
                if (this.selectedUnit) {
                    this.deselectUnit();
                }
                return;
            }

            // Ctrl+Shift+K = Save (primary, browser-safe)
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                doSave();
                return;
            }

            // Ctrl+Shift+J = Load (primary, browser-safe)
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'j') {
                e.preventDefault();
                doLoad();
                return;
            }

            // F9 = Save (backup)
            if (e.key === 'F9') {
                e.preventDefault();
                doSave();
                return;
            }

            // F10 = Load (backup)
            if (e.key === 'F10') {
                e.preventDefault();
                doLoad();
                return;
            }
        });

        console.log('[R011] Dev save/load enabled: buttons or Ctrl+Shift+K/J');
    }

    /**
     * R011: Restore all units from saved state array.
     * Updates existing Unit instances in-place and resets interpolation for visual snap.
     * @param {Array} unitDataArray - Array of serialized unit data
     */
    _restoreUnitsFromSave(unitDataArray) {
        if (!unitDataArray || !this.units) return;

        for (const data of unitDataArray) {
            const existing = this.units.find(u => u && u.id === data.id);
            if (existing) {
                this._restoreUnitFromSave(existing, data);
            }
        }
    }

    /**
     * R011: Restore a single unit from serialized save data.
     * Updates existing Unit instance in-place and resets interpolation.
     * @param {Unit} unit - Existing unit instance to update
     * @param {Object} data - Serialized unit data
     */
    _restoreUnitFromSave(unit, data) {
        // Update authoritative state
        if (data.position) {
            unit.position.set(data.position.x, data.position.y, data.position.z);
        }
        if (data.quaternion) {
            unit.quaternion.set(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w);
            // R011-fix: Also restore headingQuaternion (drives movement direction)
            // Without this, the next update() tick uses stale headingQuaternion
            if (unit.headingQuaternion) {
                unit.headingQuaternion.set(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w);
            }
            // Also update mesh quaternion for immediate visual
            if (unit.mesh) {
                unit.mesh.quaternion.set(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w);
            }
        }
        if (data.velocity) {
            unit.velocity.set(data.velocity.x, data.velocity.y, data.velocity.z);
        }
        unit.health = data.health ?? unit.health;
        unit.ownerSlot = data.ownerSlot ?? unit.ownerSlot ?? 0; // R013 M07: Ownership
        // Restore ownerHistory from saved data (if present)
        if (data.ownerHistory && Array.isArray(data.ownerHistory)) {
            unit.ownerHistory = data.ownerHistory;
        }
        // M07 Unit Authority v0: Restore selectedBySlot (handle old controllerSlot for compat)
        unit.selectedBySlot = data.selectedBySlot ?? data.controllerSlot ?? unit.selectedBySlot ?? null;
        unit.seatPolicy = data.seatPolicy ?? unit.seatPolicy ?? 'OPEN';
        unit.currentSpeed = data.currentSpeed ?? 0;
        unit.pathIndex = data.pathIndex ?? 0;
        unit.isFollowingPath = data.isFollowingPath ?? false;
        unit.pausedByCommand = data.pausedByCommand ?? false;

        // R011+R008: Reset interpolation snapshots to loaded position
        // This makes visuals snap immediately to loaded state
        if (unit._interpPrevPos && unit._interpCurrPos) {
            unit._interpPrevPos.copy(unit.position);
            unit._interpCurrPos.copy(unit.position);
        }
        if (unit._interpPrevQuat && unit._interpCurrQuat && unit.mesh) {
            unit._interpPrevQuat.copy(unit.mesh.quaternion);
            unit._interpCurrQuat.copy(unit.mesh.quaternion);
        }

        // Also update mesh position directly for immediate visual feedback
        if (unit.mesh && data.position) {
            unit.mesh.position.set(data.position.x, data.position.y, data.position.z);
        }

        return unit;
    }

    /**
     * R011 LEGACY: Restore a unit by ID lookup (kept for compatibility).
     * @deprecated Use _restoreUnitsFromSave instead
     * @param {Object} data - Serialized unit data
     */
    _restoreUnitFromSaveById(data) {
        const existing = this.units.find(u => u && u.id === data.id);
        if (existing) {
            return this._restoreUnitFromSave(existing, data);
        }
        // If unit doesn't exist, store raw data (would need UnitFactory for full hydration)
        return data;
    }

    /**
     * R006-fix: Setup canvas to receive keyboard focus.
     * Ensures document.hasFocus() and keyboard events work reliably.
     */
    _setupCanvasFocus() {
        const canvas = this.renderer.domElement;

        // Make canvas focusable
        canvas.tabIndex = 0;
        canvas.style.outline = 'none'; // Hide focus ring

        // Focus canvas on first interaction
        const focusOnce = () => {
            canvas.focus();
            canvas.removeEventListener('pointerdown', focusOnce);
            canvas.removeEventListener('click', focusOnce);
        };
        canvas.addEventListener('pointerdown', focusOnce);
        canvas.addEventListener('click', focusOnce);

        // Also focus when clicking anywhere on body (for edge cases)
        document.body.addEventListener('click', () => {
            if (document.activeElement !== canvas) {
                canvas.focus();
            }
        }, { once: false, passive: true });
    }

    /**
     * R006: Process input commands from the queue.
     * Called at the start of each simTick for deterministic command execution.
     * R013 M07: Respects ENABLE_COMMAND_EXECUTION flag for Slice 1 testing.
     *
     * M07 GAP-0 Fix: SELECT/DESELECT are UI-only (per-client visual state)
     * and always execute regardless of gate. Sim-mutating commands (MOVE,
     * SET_PATH, CLOSE_PATH) are gated by ENABLE_COMMAND_EXECUTION.
     *
     * @param {number} tickCount - Current tick number
     */
    _processInputCommands(tickCount) {
        // Always flush the queue - we need to process UI commands even if sim is gated
        const commands = (this.commandQueue || globalCommandQueue).flush(tickCount);

        // Track whether Host needs to relay commands to Guest via CMD_BATCH
        const isHost = this.sessionManager?.state?.isHost?.() ?? false;

        for (const cmd of commands) {
            // Skip commands already relayed from Host (prevent Guest re-buffering)
            const fromHost = cmd._fromHost === true;

            switch (cmd.type) {
                // === UI-ONLY COMMANDS (always execute, per-client visual state) ===
                case CommandType.SELECT: {
                    const unit = this.units.find(u => u && u.id === cmd.unitId);
                    if (unit) {
                        this.selectUnit(unit, cmd.skipCamera);
                    }
                    break;
                }
                case CommandType.DESELECT: {
                    this.deselectUnit();
                    break;
                }

                // === SIM-MUTATING COMMANDS (gated by ENABLE_COMMAND_EXECUTION) ===
                case CommandType.MOVE: {
                    if (!this.ENABLE_COMMAND_EXECUTION) break; // Gate
                    const unit = this.units.find(u => u && u.id === cmd.unitId);
                    if (unit) {
                        const pos = new THREE.Vector3(cmd.position.x, cmd.position.y, cmd.position.z);
                        this.addCommand(unit, 'Move', { position: pos });
                    }
                    // Host: buffer for CMD_BATCH relay to Guest (skip if already from CMD_BATCH)
                    if (isHost && !fromHost && this.sessionManager?.bufferInputCmd) {
                        this.sessionManager.bufferInputCmd({
                            slot: cmd.slot ?? 0,
                            seq: cmd.seq ?? 0,
                            command: { type: cmd.type, unitId: cmd.unitId, position: cmd.position }
                        });
                    }
                    break;
                }
                case CommandType.SET_PATH: {
                    if (!this.ENABLE_COMMAND_EXECUTION) break; // Gate
                    const unit = this.units.find(u => u && u.id === cmd.unitId);
                    if (unit && cmd.points && cmd.points.length > 0) {
                        // Clear existing path and add new waypoints
                        unit.commands = [];
                        unit.waypoints = [];
                        unit.waypointControlPoints = [];
                        for (const pt of cmd.points) {
                            const pos = new THREE.Vector3(pt.x, pt.y, pt.z);
                            this.addCommand(unit, 'Move', { position: pos });
                        }
                    }
                    // Host: buffer for CMD_BATCH relay to Guest
                    if (isHost && !fromHost && this.sessionManager?.bufferInputCmd) {
                        this.sessionManager.bufferInputCmd({
                            slot: cmd.slot ?? 0,
                            seq: cmd.seq ?? 0,
                            command: { type: cmd.type, unitId: cmd.unitId, points: cmd.points }
                        });
                    }
                    break;
                }
                case CommandType.CLOSE_PATH: {
                    if (!this.ENABLE_COMMAND_EXECUTION) break; // Gate
                    const unit = this.units.find(u => u && u.id === cmd.unitId);
                    if (unit) {
                        this.closePathForUnit(unit);
                    }
                    // Host: buffer for CMD_BATCH relay to Guest
                    if (isHost && !fromHost && this.sessionManager?.bufferInputCmd) {
                        this.sessionManager.bufferInputCmd({
                            slot: cmd.slot ?? 0,
                            seq: cmd.seq ?? 0,
                            command: { type: cmd.type, unitId: cmd.unitId }
                        });
                    }
                    break;
                }
                default:
                    console.warn('[Game] Unknown input command type:', cmd.type);
            }
        }
    }

    /**
     * R001: Render-only updates (camera, visuals, UI).
     * Called every frame after simTick(s). Does NOT mutate sim state.
     */
    renderUpdate() {
        // Phase 2A: Latch key presses for MOVE_INPUT (capture between 20Hz send intervals)
        if (this._mirrorMode) {
            const keys = this.input.getKeys();
            if (keys.forward) this._latchedKeys.forward = true;
            if (keys.backward) this._latchedKeys.backward = true;
            if (keys.left) this._latchedKeys.left = true;
            if (keys.right) this._latchedKeys.right = true;
        }

        this.cameraControls.update(0.016); // Update State


        const keys = this.input.getKeys();

        // M07: Gate keyboard-triggered camera transitions by seat authority
        const hasSeat = this.selectedUnit
            ? (this.sessionManager?.hasSeatedUnit?.(this.selectedUnit) ?? true)
            : false;

        // Auto-Chase: ONLY when Manual Driving (and we have the seat)
        if (this.selectedUnit && hasSeat && (keys.forward || keys.backward || keys.left || keys.right)) {
            // First keyboard press: transition to third-person view
            if (this.cameraControls.chaseMode === 'drone') {
                this.cameraControls.transitionToThirdPerson(this.selectedUnit);
                // Note: transitionToThirdPerson sets chaseTarget internally
            } else if (!this.cameraControls.isFlying) {
                // Only set chase target if NOT currently transitioning (no duplicate movement)
                this.cameraControls.setChaseTarget(this.selectedUnit);
            }
        } else if (this.selectedUnit && this.cameraControls.chaseMode === 'thirdPerson') {
            // Keep chase target ONLY in third-person mode for smooth following
            // Do NOT set chase target in drone mode (prevents auto third-person transition)
            if (!this.cameraControls.isFlying) {
                this.cameraControls.setChaseTarget(this.selectedUnit);
            }
        }

        // Update tire tracks (render-only, visual trails)
        this.units.forEach(unit => {
            if (!unit) return;
            if (!unit.tireTrackSegments) {
                unit.initTireTracks(this.scene);
            }
            unit.updateTireTracks(0.016);
        });

        // Update waypoint marker fill states
        this.updateWaypointMarkerFill();

        // NOTE: updatePanelContent is now called ONLY on events (waypoint add/delete/reorder)
        // NOT per-frame, because rebuilding DOM destroys event listeners

        // NOTE: handlePathLooping() moved to simTick() for R001 determinism

        // Update Vision Helper to follow selected unit
        if (this.visionHelper && this.selectedUnit) {
            this.visionHelper.position.copy(this.selectedUnit.position);
            const r = this.fogOfWar.currentVisionRadius || 40.0;
            this.visionHelper.scale.set(r / 15, r / 15, r / 15);
        }

        // Update visibility indicator (DEV mode only)
        const visIndicator = document.getElementById('visibility-indicator');
        if (visIndicator && this._isDevMode) {
            if (this.selectedUnit && this.cameraControls) {
                visIndicator.classList.remove('hidden');
                const obstructionHeight = this.cameraControls.currentObstructionHeight || 0;
                const isObstructed = obstructionHeight > 1.0; // If camera had to rise more than 1 unit

                if (isObstructed) {
                    visIndicator.classList.add('obstructed');
                    visIndicator.querySelector('.visibility-text').textContent = 'OBSTRUCTED';
                } else {
                    visIndicator.classList.remove('obstructed');
                    visIndicator.querySelector('.visibility-text').textContent = 'VISIBLE';
                }
            } else {
                visIndicator.classList.add('hidden');
            }
        }

        // Update FOW with ALL units (shader-based spherical FOW)
        if (this.units.length > 0) {
            this.fogOfWar.update(this.units);
        }

        // Update water animation (waves + FOW)
        if (this.planet && this.planet.updateWater) {
            const dt = this.clock ? this.clock.getDelta() : 1 / 60;
            this.planet.updateWater(dt, this.units, this.fogOfWar);
        }

        // Update Planet Uniforms
        if (this.planet.mesh.material.materialShader) {
            this.planet.mesh.material.materialShader.uniforms.uFogTexture.value = this.fogOfWar.exploredTarget.texture;
            this.planet.mesh.material.materialShader.uniforms.uVisibleTexture.value = this.fogOfWar.visibleTarget.texture;
        }
        if (this.planet.waterMesh.material.materialShader) {
            this.planet.waterMesh.material.materialShader.uniforms.uFogTexture.value = this.fogOfWar.exploredTarget.texture;
            this.planet.waterMesh.material.materialShader.uniforms.uVisibleTexture.value = this.fogOfWar.visibleTarget.texture;
        }
        // Update starField FOW texture
        if (this.planet.starField && this.planet.starField.material.uniforms) {
            this.planet.starField.material.uniforms.uFogTexture.value = this.fogOfWar.exploredTarget.texture;
        }

        // Update Rock FOW textures
        if (this.planet.rockSystem && this.planet.rockSystem.materials) {
            for (let i = 0; i < this.planet.rockSystem.materials.length; i++) {
                const mat = this.planet.rockSystem.materials[i];
                if (mat.materialShader && mat.materialShader.uniforms) {
                    mat.materialShader.uniforms.uFogTexture.value = this.fogOfWar.exploredTarget.texture;
                    mat.materialShader.uniforms.uVisibleTexture.value = this.fogOfWar.visibleTarget.texture;
                }
            }
        }

        // Update Path Visuals
        this.updatePathVisuals();

        // Update Audio System
        if (this.audioManager) {
            // Distance from planet center (Origin)
            const camDist = this.camera.position.length();
            this.audioManager.update(camDist, this.units);
        }
    }

    animate() {
        try {
            // R001: Run fixed-timestep sim ticks, then render
            this.simLoop.step(performance.now());
            this.renderUpdate();
            this.renderer.render(this.scene, this.camera);
            this.adaptivePerf.update(performance.now());
        } catch (err) {
            // Show error on screen for diagnosis (user may not have console open)
            if (!this._animateErrorShown) {
                this._animateErrorShown = true;
                console.error('[Game] animate() error:', err);
                const errDiv = document.createElement('div');
                errDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);color:#ff4444;padding:24px;border-radius:12px;z-index:99999;font-family:monospace;font-size:14px;max-width:80%;white-space:pre-wrap;';
                errDiv.textContent = 'GAME ERROR:\n' + err.message + '\n\n' + err.stack;
                document.body.appendChild(errDiv);
            }
        }

        // Trigger onFirstRender callback after enough frames to ensure content visible
        // Wait for 30 frames (about 0.5s at 60fps) to ensure textures loaded
        if (!this._frameCount) this._frameCount = 0;
        this._frameCount++;

        if (this.onFirstRender && !this._firstRenderDone && this.assetsLoaded && this._frameCount > 30) {
            this._firstRenderDone = true;
            this.onFirstRender();
        }

        if (this.textureDebugger) {
            this.textureDebugger.update();
        }

        requestAnimationFrame(this.animate);
    }

    toggleUnitPause(unitId) {
        let unit = this.focusedUnit;
        if (unitId) {
            unit = this.units.find(u => u.id == unitId);
        }

        if (!unit) return;

        unit.pausedByCommand = !unit.pausedByCommand;

        if (this._isDevMode) console.log(`Unit ${unit.id} Paused: ${unit.pausedByCommand}`);

        if (this.isFocusMode && this.focusedUnit === unit) {
            this.updatePanelContent(unit);
        }
    }

    // === PATH PLANNER DEBUG VISUALIZATION ===
    updatePathPlannerDebug() {
        if (!this.pathPlanner) return;
        
        // Remove old debug mesh
        if (this.pathPlannerDebugMesh) {
            this.scene.remove(this.pathPlannerDebugMesh);
            this.pathPlannerDebugMesh.geometry.dispose();
            this.pathPlannerDebugMesh.material.dispose();
            this.pathPlannerDebugMesh = null;
        }
        
        const debugPoints = this.pathPlanner.getDebugPoints();
        if (!debugPoints || debugPoints.length === 0) return;
        
        // Create geometry
        const positions = new Float32Array(debugPoints.length * 3);
        const colors = new Float32Array(debugPoints.length * 3);
        
        // 3-ZONE COLOR SYSTEM
        const freeColor = new THREE.Color(0x00ff88);       // Green - FREE
        const avoidanceColor = new THREE.Color(0xffaa00);  // Yellow/Orange - AVOIDANCE
        const forbiddenColor = new THREE.Color(0xff4444); // Red - FORBIDDEN
        
        for (let i = 0; i < debugPoints.length; i++) {
            const pt = debugPoints[i];
            positions[i * 3] = pt.position.x;
            positions[i * 3 + 1] = pt.position.y;
            positions[i * 3 + 2] = pt.position.z;
            
            // Determine color based on zone type
            let color;
            if (pt.zoneType === 'FORBIDDEN') {
                color = forbiddenColor;
            } else if (pt.zoneType === 'AVOIDANCE') {
                color = avoidanceColor;
            } else {
                color = freeColor;
            }
            
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const material = new THREE.PointsMaterial({
            size: 0.5,
            vertexColors: true,
            sizeAttenuation: true,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            opacity: 0.9
        });
        
        this.pathPlannerDebugMesh = new THREE.Points(geometry, material);
        this.pathPlannerDebugMesh.renderOrder = 200; // Render on top
        this.scene.add(this.pathPlannerDebugMesh);
        
        if (this._isDevMode) console.log(`[Game] PathPlanner debug: ${debugPoints.length} points visualized`);
    }

}

