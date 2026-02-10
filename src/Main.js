import { Game } from './Core/Game.js';

// VERSION - displayed on screen
const VERSION = 'V2.0.013';

window.addEventListener('DOMContentLoaded', () => {
    // Display version number at top of screen
    const versionDiv = document.createElement('div');
    versionDiv.id = 'version-display';
    versionDiv.textContent = VERSION;
    versionDiv.style.cssText = 'position:fixed;top:5px;right:10px;color:rgba(255,255,255,0.5);font-family:monospace;font-size:12px;z-index:9999;pointer-events:none;';
    document.body.appendChild(versionDiv);
    
    let game;
    try {
        game = new Game();
        console.log('[Main] Game constructor completed OK');
    } catch (err) {
        console.error('[Main] Game constructor CRASHED:', err);
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.95);color:#ff4444;padding:24px;border-radius:12px;z-index:99999;font-family:monospace;font-size:14px;max-width:80%;white-space:pre-wrap;';
        errDiv.textContent = 'GAME INIT ERROR:\n' + err.message + '\n\n' + err.stack;
        document.body.appendChild(errDiv);
        return; // Stop execution
    }
    window.game = game; // Expose for UI access

    // Fallback camera position: outside the planet so scene isn't black
    // (will be overridden when models load via positionCameraAboveUnit)
    if (game.camera && game.planet && game.planet.terrain) {
        const r = game.planet.terrain.params.radius || 50;
        game.camera.position.set(0, 0, r + 30);
        game.camera.lookAt(0, 0, 0);
    }

    // Start loading music in background immediately
    // (Will play after user gesture)
    let musicStartTime = null;
    let worldReady = false;

    // Set callback for when game is fully rendered (world is ready)
    game.onFirstRender = () => {
        worldReady = true;
        console.log('[Main] World fully rendered!');
    };

    // Get DOM elements
    const startScreen = document.getElementById('start-screen');
    const startBtnDev = document.getElementById('start-btn-dev');
    const startBtnGame = document.getElementById('start-btn-game');
    const loader = document.getElementById('loader');

    // Start background music loading as soon as possible
    // This will preload the audio file but NOT play it (needs user gesture)
    if (game.audioManager) {
        game.audioManager.preloadMusic();
    }

    // Show start screen when JoinOverlay is done (Game.js will call this)
    window.showModeSelection = () => {
        if (startScreen) {
            startScreen.style.display = 'flex';
        }
    };

    const startGame = (mode) => {
        console.log('[Main] Starting game with mode:', mode);

        // Apply mode settings via Game.applyDevMode()
        if (game.applyDevMode) {
            game.applyDevMode(mode === 'dev');
        }

        // 1. IMMEDIATELY show preloader (add visible class)
        if (loader) {
            loader.classList.add('visible');
            loader.classList.remove('fade-stage-1', 'fade-stage-2', 'fade-complete');
            console.log('[Main] Loader visible');
        }

        // 2. Hide start screen with fade
        if (startScreen) {
            startScreen.classList.add('fade-out');
            setTimeout(() => startScreen.remove(), 500);
        }

        // 3. Start Music (User Gesture) - Start playing as soon as loaded
        if (game.audioManager) {
            game.audioManager.startMusic();
        }

        // 4. Wait for music to start, then track when it started
        const gameStartTime = Date.now();
        const MAX_WAIT_MS = 10000; // Max wait for music condition
        const ABSOLUTE_MAX_WAIT_MS = 15000; // Absolute max - start even if world not ready

        const fadePreloader = () => {
            console.log('[Main] Fading preloader...');
            if (loader) {
                loader.classList.add('fade-stage-1');

                // #1/#9: No auto-select at startup - units start unselected
                // Players must click to select (triggers seat flow for guests)

                setTimeout(() => loader.classList.add('fade-stage-2'), 1000);
                setTimeout(() => loader.classList.add('fade-complete'), 2000);
            }
        };

        const waitForMusicAndWorld = () => {
            const musicPlaying = game.audioManager && game.audioManager.isMusicPlaying();
            const elapsed = Date.now() - gameStartTime;

            // If music just started playing, record the time
            if (musicPlaying && !musicStartTime) {
                musicStartTime = Date.now();
                console.log('[Main] Music started playing!');
            }

            // Calculate how long music has been playing
            const musicPlayingDuration = musicStartTime ? (Date.now() - musicStartTime) : 0;
            const MIN_MUSIC_DURATION_MS = 2000; // Reduced to 2 seconds for faster load

            // Debug: Log status every second
            if (elapsed % 1000 < 100) {
                console.log(`[Preloader] worldReady=${worldReady} musicPlaying=${musicPlaying} musicDuration=${musicPlayingDuration}ms elapsed=${elapsed}ms assetsLoaded=${game.assetsLoaded}`);
            }

            // ABSOLUTE TIMEOUT: If 15 seconds have passed, start no matter what
            if (elapsed >= ABSOLUTE_MAX_WAIT_MS) {
                console.warn('[Main] Absolute timeout reached (' + ABSOLUTE_MAX_WAIT_MS + 'ms). Starting game regardless of asset/music state.');
                fadePreloader();
                return;
            }

            // Normal conditions for fade:
            // 1. World is ready (first render complete)
            // 2. Music has been playing for at least 2 seconds
            // 3. OR soft timeout reached (10 seconds) - skip music condition
            const musicCondition = musicPlayingDuration >= MIN_MUSIC_DURATION_MS;
            const softTimeout = elapsed >= MAX_WAIT_MS;
            const canFade = worldReady && (musicCondition || softTimeout);

            if (softTimeout && !musicCondition && worldReady) {
                console.warn('[Main] Soft timeout reached, starting game without music condition');
            }

            if (canFade) {
                fadePreloader();
            } else {
                // Keep waiting
                setTimeout(waitForMusicAndWorld, 100);
            }
        };

        // Start checking
        waitForMusicAndWorld();
    };

    // Attach button listeners
    if (startBtnDev) {
        startBtnDev.addEventListener('click', () => startGame('dev'));
    }
    if (startBtnGame) {
        startBtnGame.addEventListener('click', () => startGame('game'));
    }

    // Start the game (rendering begins, but UI waits for button)
    game.start();
});
