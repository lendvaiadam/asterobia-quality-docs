import * as THREE from 'three';
import { RockMeshGenerator } from '../World/RockMeshGenerator.js';

export class RockDebug {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.generator = new RockMeshGenerator();
        this.currentRock = null;
        
        // Default parameters (Refined for Phase 2)
        this.params = {
            seed: 123,
            radius: 1.2,      // Default 1.2
            detail: 20,       // Range 1-50, Default 20 (Note: Generator maps detail to segments)
            scrapeCount: 6,
            scrapeMinDist: 0.9,
            scrapeStrength: 0.15, // ScrapeStern? Assumption: Strength
            scrapeRadius: 0.25,   // scrape-eRadius
            noiseScale: 1.0,      // noise eScale
            noiseStrength: 0.16,
            flatTop: true,        // Yes
            flatTopRadius: 0.9,
            scaleX: 1.55,
            scaleY: 0.93,
            scaleZ: 1.69
        };

        this.initDebug();
    }

    initDebug() {
        if (!this.game.debugPanel) return;

        const pane = this.game.debugPanel.pane;
        const folder = pane.addFolder({ title: 'Rock Gen Debug' });

        folder.addBinding(this.params, 'seed', { min: 0, max: 999, step: 1 });
        folder.addBinding(this.params, 'radius', { min: 0.5, max: 2.0 });
        folder.addBinding(this.params, 'detail', { min: 0, max: 50, step: 1 });
        
        const scrapeFolder = folder.addFolder({ title: 'Scrapes' });
        scrapeFolder.addBinding(this.params, 'scrapeCount', { min: 0, max: 20, step: 1 });
        scrapeFolder.addBinding(this.params, 'scrapeMinDist', { min: 0.1, max: 2 });
        scrapeFolder.addBinding(this.params, 'scrapeStrength', { min: 0, max: 1 });
        scrapeFolder.addBinding(this.params, 'scrapeRadius', { min: 0.1, max: 2 });

        const noiseFolder = folder.addFolder({ title: 'Noise' });
        noiseFolder.addBinding(this.params, 'noiseScale', { min: 0.1, max: 5 });
        noiseFolder.addBinding(this.params, 'noiseStrength', { min: 0, max: 1 });

        const shapeFolder = folder.addFolder({ title: 'Shape' });
        shapeFolder.addBinding(this.params, 'flatTop');
        shapeFolder.addBinding(this.params, 'flatTopRadius', { min: 0.1, max: 2 });
        shapeFolder.addBinding(this.params, 'scaleX', { min: 0.5, max: 3 });
        shapeFolder.addBinding(this.params, 'scaleY', { min: 0.5, max: 3 });
        shapeFolder.addBinding(this.params, 'scaleZ', { min: 0.5, max: 3 });

        folder.addButton({ title: 'Generate Rock' }).on('click', () => {
            this.generate();
        });
        
        // Auto-regenerate on change (disabled by default)
        // folder.on('change', () => {
        //      this.generate();
        // });

        // NO INITIAL GENERATION - only generate when user clicks
        // this.generate();
        console.log('[RockDebug] Panel ready - click "Generate Rock" to create test rock');
    }

    generate() {
        // Remove old rock
        if (this.currentRock) {
            this.scene.remove(this.currentRock);
            this.currentRock.geometry.dispose();
            this.currentRock.material.dispose();
            this.currentRock = null;
        }
        
        if (this.currentBox) {
            this.scene.remove(this.currentBox);
            this.currentBox = null;
        }

        const scale = new THREE.Vector3(this.params.scaleX, this.params.scaleY, this.params.scaleZ);

        const { geometry } = this.generator.generate({
            radius: this.params.radius,
            detail: this.params.detail,
            scrapeCount: this.params.scrapeCount,
            scrapeMinDist: this.params.scrapeMinDist,
            scrapeStrength: this.params.scrapeStrength,
            scrapeRadius: this.params.scrapeRadius,
            noiseScale: this.params.noiseScale,
            noiseStrength: this.params.noiseStrength,
            scale: scale,
            flatTop: this.params.flatTop,
            flatTopRadius: this.params.flatTopRadius
        });

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9,
            flatShading: false // SMOOTH SHADING PREFERRED
        });

        this.currentRock = new THREE.Mesh(geometry, material);
        // Calculate exact surface position
        const dir = new THREE.Vector3(0, 1, 0);
        const surfaceRadius = this.game.planet.terrain.getRadiusAt(dir);
        this.currentRock.position.copy(dir.multiplyScalar(surfaceRadius));
        
        this.currentRock.castShadow = true;
        this.currentRock.receiveShadow = true;
        
        // Add axes helper for visibility
        const axes = new THREE.AxesHelper(5);
        this.currentRock.add(axes);
        
        // Add a box helper to make it very obvious if the mesh is tiny or invisible
        const box = new THREE.BoxHelper(this.currentRock, 0xffff00);
        this.scene.add(box);
        this.currentBox = box; // Track to remove later

        this.scene.add(this.currentRock);
        
        console.log(`Rock Generated at radius ${surfaceRadius}`, this.params);
    }
}
