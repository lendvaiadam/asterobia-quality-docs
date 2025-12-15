import * as THREE from 'three';
import { RockMeshGenerator } from './RockMeshGenerator.js';

export class RockSystem {
    constructor(game, planet) {
        this.game = game;
        this.planet = planet;
        this.generator = new RockMeshGenerator();
        this.rocks = [];
        this.rockGroup = new THREE.Group();
        this.scene = game.scene;
        
        this.scene.add(this.rockGroup);
        
        // Default params
        this.params = {
            count: 60,        // Increased from 40 (+20 smaller)
            seed: 12345,
            minScale: 0.5,    // Smaller rocks now allowed
            maxScale: 3.0,
            radius: 1.2,
            detail: 2
        };
        
        // Load 4 rock texture variants
        const textureLoader = new THREE.TextureLoader();
        this.materials = [];
        
        // Texture tuning values - logged to console for adjustment
        this.textureConfig = {
            normalScale: 1.0,
            roughness: 0.85,
            metalness: 0.05
        };
        console.log('[RockSystem] Texture config:', this.textureConfig);
        console.log('[RockSystem] To change: game.rockSystem.textureConfig.normalScale = X');
        
        for (let i = 1; i <= 4; i++) {
            const diffusePath = `assets/textures/rock_${i}.png`;
            const normalPath = `assets/textures/rock_${i}_normal.png`;
            
            const diffuse = textureLoader.load(diffusePath, () => {
                console.log(`[RockSystem] Loaded: ${diffusePath}`);
            });
            const normal = textureLoader.load(normalPath);
            
            diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping;
            normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
            
            const mat = new THREE.MeshStandardMaterial({
                map: diffuse,
                normalMap: normal,
                normalScale: new THREE.Vector2(this.textureConfig.normalScale, this.textureConfig.normalScale),
                roughness: this.textureConfig.roughness,
                metalness: this.textureConfig.metalness,
                flatShading: false
            });
            
            // Apply FOW shader to EACH material
            const self = this;
            mat.onBeforeCompile = (shader) => {
                shader.uniforms.uFogTexture = { value: self.game.fogOfWar?.exploredTarget?.texture || null };
                shader.uniforms.uVisibleTexture = { value: self.game.fogOfWar?.visibleTarget?.texture || null };
                shader.uniforms.uUVScale = { value: new THREE.Vector2(1, 1) };
                shader.uniforms.uUVOffset = { value: new THREE.Vector2(0, 0) };

                shader.fragmentShader = `
                    uniform sampler2D uFogTexture;
                    uniform sampler2D uVisibleTexture;
                    uniform vec2 uUVScale;
                    uniform vec2 uUVOffset;
                ` + shader.fragmentShader;
                
                shader.vertexShader = `
                    varying vec3 vWorldPosition;
                ` + shader.vertexShader;
                
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <worldpos_vertex>',
                    `
                    #include <worldpos_vertex>
                    vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
                    `
                );
                
                shader.fragmentShader = `
                    varying vec3 vWorldPosition;
                ` + shader.fragmentShader;
                
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <dithering_fragment>',
                    `
                    vec3 dir = normalize(vWorldPosition); 
                    float u = 0.5 + atan(dir.z, dir.x) / (2.0 * 3.14159265);
                    float v = 0.5 + asin(dir.y) / 3.14159265;
                    
                    u = u * uUVScale.x + uUVOffset.x;
                    v = v * uUVScale.y + uUVOffset.y;
                    
                    vec4 explored = texture2D(uFogTexture, vec2(u, v));
                    vec4 visible = texture2D(uVisibleTexture, vec2(u, v));
                    
                    float isVisible = visible.r; 
                    float isExplored = explored.r;
                    
                    vec3 finalColor = gl_FragColor.rgb;
                    
                    if (isVisible > 0.1) {
                        // Visible - keep original color
                    } else if (isExplored > 0.1) {
                        // Explored - desaturate/darken
                        float gray = dot(finalColor, vec3(0.299, 0.587, 0.114));
                        gray = pow(gray, 1.5);
                        vec3 desaturated = vec3(gray);
                        vec3 nightColor = vec3(0.02, 0.04, 0.08); 
                        finalColor = mix(finalColor, desaturated, 0.95) * 0.2 + nightColor * 0.1;
                    } else {
                        // Unexplored - SOLID BLACK
                        finalColor = vec3(0.0, 0.0, 0.0);
                    }
                    
                    gl_FragColor = vec4(finalColor, gl_FragColor.a);
                    #include <dithering_fragment>
                    `
                );
                
                mat.materialShader = shader;
            };
            
            this.materials.push(mat);
        }
        
        // Default material (first one)
        this.material = this.materials[0];
        
        // FOW is now applied to each material in the loop above
    }

    generateRocks() {
        // Clear existing
        while(this.rockGroup.children.length > 0){ 
            const mesh = this.rockGroup.children[0];
            if(mesh.geometry) mesh.geometry.dispose();
            this.rockGroup.remove(mesh);
        }
        this.rocks = [];

        console.log(`Generating ${this.params.count} rocks...`);

        // Pseudo-random generator
        const seedRandom = (s) => {
            let mask = 0xffffffff;
            let m_w = (123456789 + s) & mask;
            let m_z = (987654321 - s) & mask;
            return () => {
                m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
                m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;
                var result = ((m_z << 16) + (m_w & 65535)) >>> 0;
                result /= 4294967296;
                return result;
            };
        };

        const rng = seedRandom(this.params.seed);

        for (let i = 0; i < this.params.count; i++) {
            // 1. Random Position on Sphere
            const u = rng();
            const v = rng();
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);
            
            const dir = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            );
            
            // 2. Get Terrain Height
            const terrainRadius = this.planet.terrain.getRadiusAt(dir);
            
            // Avoid water?
            // If terrain radius is close to default radius (water level), maybe skip?
            // User didn't specify, but usually rocks are on land.
            // Let's blindly place them for now.
            
            // 3. Generate Unique Rock Mesh (Time consuming?)
            // For 60 rocks, generating 60 unique meshes is fine.
            const scaleVal = this.params.minScale + rng() * (this.params.maxScale - this.params.minScale);
            
            const rockParams = {
                radius: this.params.radius,
                detail: this.params.detail,
                scale: new THREE.Vector3(scaleVal, scaleVal, scaleVal),
                // Vary seed for each rock
                // Actually RockGen uses noise internally, does it accept a seed?
                // RockMeshGenerator uses `createNoise3D`. It doesn't seem to take a seed param in generate().
                // But it instantiates `noise3D` in constructor.
                // To vary rocks, we might need new generator instances OR update generator to offset noise.
                // Looking at RockMeshGenerator inside: `this._applyNoise` uses `vertex.x`. 
                // To vary, we can offset the input coordinates to noise!
            };
            
            // Generate
            const { geometry } = this.generator.generate(rockParams);
            
            // Fix position - SINK INTO GROUND for flush shadow at contact
            // This ensures shadow appears at terrain-rock junction, not floating
            const sinkDepth = scaleVal * 0.15; // 15% of rock size sinks below surface
            const pos = dir.clone().multiplyScalar(terrainRadius - sinkDepth);
            
            // Random material from 4 variants
            const matIndex = Math.floor(rng() * this.materials.length);
            const selectedMaterial = this.materials[matIndex];
            
            const mesh = new THREE.Mesh(geometry, selectedMaterial);
            mesh.position.copy(pos);
            mesh.lookAt(new THREE.Vector3(0,0,0)); // Point down?
            // Align Up to Normal
            const up = pos.clone().normalize();
            const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
            mesh.quaternion.copy(quaternion);
            
            // Random rotation around Up
            const randRot = rng() * Math.PI * 2;
            mesh.rotateY(randRot);
            
            // Store collision radius (based on deformed scale)
            mesh.userData.collisionRadius = scaleVal * this.params.radius;
            
            // Cast Shadow
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            // SHADOW EXTENSION: Invisible geometry extending below rock into ground
            // This prevents light bleeding at rock-terrain junction on shadow side
            // The shadow of this extension blocks light from going "under" the rock
            const extensionHeight = scaleVal * 0.5; // Extend 50% of rock size into ground
            const extensionRadius = scaleVal * 0.7; // 70% of rock width
            const shadowExtGeo = new THREE.CylinderGeometry(extensionRadius, extensionRadius * 0.8, extensionHeight, 8);
            shadowExtGeo.translate(0, -extensionHeight * 0.5, 0); // Move pivot to top
            
            // Invisible material - only casts shadows, not rendered
            const shadowExtMat = new THREE.MeshBasicMaterial({ 
                visible: false // Invisible but still casts shadows
            });
            const shadowExtension = new THREE.Mesh(shadowExtGeo, shadowExtMat);
            shadowExtension.position.copy(pos);
            shadowExtension.quaternion.copy(quaternion);
            shadowExtension.castShadow = true; // Cast shadow into the "under" area
            shadowExtension.receiveShadow = false;
            this.rockGroup.add(shadowExtension);
            
            // CONTACT SHADOW (Blob beneath rock to prevent floating look)
            const shadowRadius = scaleVal * 0.8; // Slightly smaller than rock
            const contactShadowGeo = new THREE.CircleGeometry(shadowRadius, 32);
            contactShadowGeo.rotateX(-Math.PI / 2);
            const contactShadowMat = new THREE.ShaderMaterial({
                uniforms: {},
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    varying vec2 vUv;
                    void main() {
                        float dist = length(vUv - vec2(0.5, 0.5)) * 2.0;
                        float alpha = smoothstep(1.0, 0.2, dist) * 0.6; // Max 60% for rocks
                        gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
            contactShadow.position.copy(pos);
            contactShadow.position.addScaledVector(up, 0.02); // Just above terrain
            contactShadow.quaternion.copy(quaternion);
            contactShadow.renderOrder = -1;
            this.rockGroup.add(contactShadow);
            
            this.rockGroup.add(mesh);
            this.rocks.push(mesh);
        }
    }
}
