import * as THREE from 'three';

export class AudioManager {
    constructor() {
        this.listener = new THREE.AudioListener();
        this.audioLoader = new THREE.AudioLoader();
        
        // Ambient sounds
        this.spaceSound = null;
        this.atmoSound = null;
        
        // Unit sounds registry
        // Map<Unit, THREE.PositionalAudio>
        this.unitSounds = new Map();
        
        this.isInitialized = false;
        
        // Audio Params
        this.planetRadius = 100; // Default, can be updated
        this.crossfadeStart = 110; // Distance where Atmo starts fading out (Extremely close only)
        this.crossfadeEnd = 160;   // Distance where Space is full volume (Planet fully visible)
        
        // Startup Logic
        this.startupTime = -1;
        this.startupDuration = 15.0; // Seconds to fade from "Intro Loudness" to "Normal Distance Volume"
        this.fadeInDuration = 3.0; // Seconds for initial volume fade-in (0 -> 1)
        this.atmosphereDelay = 5.0; // Seconds before atmosphere starts fading in
    }

    init(camera) {
        if (this.isInitialized) return;
        
        this.camera = camera;
        this.listener = new THREE.AudioListener();
        camera.add(this.listener);

        this.audioLoader = new THREE.AudioLoader();

        // Load Space Ambience (Globally)
        this.spaceSound = new THREE.Audio(this.listener);
        this.audioLoader.load('assets/audio/Bolygo_1.mp3', (buffer) => {
            this.spaceSound.setBuffer(buffer);
            this.spaceSound.setLoop(true);
            this.spaceSound.setVolume(0.5); // Initial base
            this.spaceSound.play(); // Start playing immediately
        });

        // Load Atmosphere Ambience (Globally)
        this.atmoSound = new THREE.Audio(this.listener);
        this.audioLoader.load('assets/audio/Atmosphere_1.mp3', (buffer) => {
            this.atmoSound.setBuffer(buffer);
            this.atmoSound.setLoop(true);
            this.atmoSound.setVolume(0); // Start silent
            this.atmoSound.play();
        });
        
        this.isInitialized = true;
        console.log("AudioManager initialized");
    }
    
    // Resume context (browser policy)
    resumeContext() {
        if (this.listener.context.state === 'suspended') {
            this.listener.context.resume();
        }
        if (this.startupTime === -1) {
            this.startupTime = this.listener.context.currentTime;
        }
    }

    addUnitSound(unit) {
        if (!unit.mesh) return;
        
        const sound = new THREE.PositionalAudio(this.listener);
        this.audioLoader.load('assets/audio/Motor_hum_1.mp3', (buffer) => {
            sound.setBuffer(buffer);
            sound.setRefDistance(10); // Distance over which sound reduces by half
            sound.setRolloffFactor(1.5); // How fast volume drops
            sound.setLoop(true);
            sound.setVolume(0);
            sound.play();
            
            unit.mesh.add(sound);
            this.unitSounds.set(unit, sound);
        });
    }

    resumeContext() {
        if (this.listener.context.state === 'suspended') {
            this.listener.context.resume();
        }
    }

    update(cameraDistance, units) {
        // Resume context if needed
        if (this.listener.context.state === 'suspended') {
            // We rely on user interaction elsewhere to resume, but we can try
        }
        
        if (this.startupTime === -1) {
            this.startupTime = this.listener.context.currentTime;
        }
        
        const time = this.listener.context.currentTime;
        const elapsed = time - this.startupTime;
        
        // === 1. MUSIC & ATMOSPHERE MIXING ===
        // Startup Override: 
        // For first 15s (startupDuration), Music is FORCE PLAYING at High Volume
        // Then fades to distance-based mixing.
        
        let startupMix = 0; // 0 = normal distance logic, 1 = startup override
        if (elapsed < this.startupDuration) {
            startupMix = 1.0;
        } else if (elapsed < this.startupDuration + 5.0) {
            // Fade out the override over 5 seconds
            startupMix = 1.0 - (elapsed - this.startupDuration) / 5.0;
        }
        
        // Calculate Distance-Based Volumes
        // Near Surface (< crossfadeStart): Max Atmo, Min Space
        // Deep Space (> crossfadeEnd): Min Atmo, Max Space
        
        let spaceVol = 0;
        let atmoVol = 0;
        
        const dist = cameraDistance - this.planetRadius;
        const t = THREE.MathUtils.clamp((dist - (this.crossfadeStart - 100)) / (this.crossfadeEnd - this.crossfadeStart), 0, 1);
        
        spaceVol = t;         // 0 at surface, 1 at space
        atmoVol = 1.0 - t;    // 1 at surface, 0 at space
        
        // Apply Startup Override: Force Space (Music) to 1.0, Atmo to 0.5
        // User Request: "Az elején mindenképpen szóljon 15 másodperci"
        if (startupMix > 0) {
            const targetSpace = 0.8; // Loud music at start
            const targetAtmo = 0.2;
            spaceVol = THREE.MathUtils.lerp(spaceVol, targetSpace, startupMix);
            atmoVol = THREE.MathUtils.lerp(atmoVol, targetAtmo, startupMix);
        }
        
        // User Request: "azért nagyon halkan még a unit közvetlen közelében is lehessen hallani"
        // Ensure Space Music never drops below 0.05
        spaceVol = Math.max(spaceVol, 0.05);

        if (this.spaceSound && this.spaceSound.isPlaying) {
            this.spaceSound.setVolume(spaceVol);
        }
        
        if (this.atmoSound && this.atmoSound.isPlaying) {
            this.atmoSound.setVolume(atmoVol * 0.6); // Atmosphere slightly quieter overall
        }
        

        // Update Unit Sounds
        if (units) {
            this.updateUnitSounds(units);
        }
    }

    // Helper to update unit sounds based on sound
    updateUnitSounds(units) {
         units.forEach(unit => {
            const sound = this.unitSounds.get(unit);
            if (sound && sound.isPlaying) {
                // Volume based on speed
                // Speed ~0 -> Volume 0.3 (Idle - always audible)
                // Speed ~5 (Max) -> Volume 0.8
                const speed = unit.currentSpeed || 0;
                const targetVol = THREE.MathUtils.lerp(0.3, 0.8, Math.min(speed / 5.0, 1.0));
                
                // Smooth transition
                sound.setVolume(THREE.MathUtils.lerp(sound.getVolume(), targetVol, 0.1));
            }
        });
    }
}
