import * as THREE from 'three';
import { Terrain } from './Terrain.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export class Planet {
    constructor(scene) {
        this.scene = scene;
        this.terrain = new Terrain();
        this.meshResolution = 308;
        this.mesh = this.createMesh();
        this.mesh.receiveShadow = true;
        this.waterMesh = this.createWaterMesh();
        this.starField = this.createStarField(30000);
    }

    createWaterMesh() {
        const waterLevel = this.terrain.params.waterLevel;
        const waterRadius = this.terrain.params.radius + waterLevel;

        const geometry = new THREE.SphereGeometry(waterRadius, 64, 64);
        const material = new THREE.MeshPhysicalMaterial({
            color: 0x4488aa,
            transparent: true,
            opacity: 0.6,
            roughness: 0.1,
            metalness: 0.1,
            side: THREE.DoubleSide
        });

        // Water shader with FOW and simple waves
        const self = this;
        material.onBeforeCompile = (shader) => {
            // Wave uniforms
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uWaveHeight = { value: 0.05 };

            // FOW uniforms
            shader.uniforms.uFogTexture = { value: null };
            shader.uniforms.uVisibleTexture = { value: null };

            // Vertex shader - add time uniform and wave displacement
            shader.vertexShader = `
                uniform float uTime;
                uniform float uWaveHeight;
                varying vec3 vWorldPosition;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                // No vertex displacement - water surface stays still
                // Surface ripples will be done in fragment shader
                `
            );

            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `
                #include <worldpos_vertex>
                vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
                `
            );

            // Fragment shader - FOW integration
            shader.fragmentShader = `
                uniform sampler2D uFogTexture;
                uniform sampler2D uVisibleTexture;
                varying vec3 vWorldPosition;
            ` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `
                // Calculate spherical UV for FOW lookup
                vec3 dir = normalize(vWorldPosition);
                float u = 0.5 + atan(dir.z, dir.x) / (2.0 * 3.14159265);
                float v = 0.5 + asin(dir.y) / 3.14159265;
                
                // Sample FOW textures
                vec4 explored = texture2D(uFogTexture, vec2(u, v));
                vec4 visible = texture2D(uVisibleTexture, vec2(u, v));
                
                float isVisible = visible.r;
                float isExplored = explored.r;
                
                vec3 finalColor = gl_FragColor.rgb;
                
                if (isVisible > 0.1) {
                    // Visible - bright water
                    finalColor = finalColor * 1.2;
                } else if (isExplored > 0.1) {
                    // Explored - dark memory water
                    float gray = dot(finalColor, vec3(0.299, 0.587, 0.114));
                    vec3 desaturated = vec3(gray);
                    finalColor = mix(finalColor, desaturated, 0.8) * 0.3;
                } else {
                    // Unexplored - invisible
                    discard;
                }
                
                gl_FragColor = vec4(finalColor, gl_FragColor.a);
                #include <dithering_fragment>
                `
            );

            // Store shader reference
            material.waveShader = shader;
            material.materialShader = shader;
        };

        // Store material for animation
        this.waterMaterial = material;
        this.waterTime = 0;

        return new THREE.Mesh(geometry, material);
    }

    // Call this each frame to animate water
    updateWater(dt, units = [], fogOfWar = null) {
        if (!this.waterTime) this.waterTime = 0;
        this.waterTime += dt;

        if (this.waterMaterial && this.waterMaterial.waveShader) {
            const shader = this.waterMaterial.waveShader;

            // Update time for wave animation
            shader.uniforms.uTime.value = this.waterTime;

            // Update FOW textures if available
            if (fogOfWar) {
                shader.uniforms.uFogTexture.value = fogOfWar.exploredTarget?.texture || null;
                shader.uniforms.uVisibleTexture.value = fogOfWar.visibleTarget?.texture || null;
            }
        }
    }

    createMesh() {
        const resolution = this.meshResolution;
        let geometry = new THREE.BoxGeometry(1, 1, 1, resolution, resolution, resolution);
        geometry.deleteAttribute('normal');
        geometry.deleteAttribute('uv');
        geometry = mergeVertices(geometry);

        const positions = geometry.attributes.position;
        const colors = [];
        const v3 = new THREE.Vector3();

        for (let i = 0; i < positions.count; i++) {
            v3.set(positions.getX(i), positions.getY(i), positions.getZ(i));
            v3.normalize();

            const heightOffset = this.terrain.getHeight(v3.x, v3.y, v3.z);
            const radius = this.terrain.params.radius + heightOffset;

            const newPos = v3.clone().multiplyScalar(radius);
            positions.setXYZ(i, newPos.x, newPos.y, newPos.z);

            const moisture = this.terrain.getMoisture(v3.x, v3.y, v3.z);
            const temperature = this.terrain.getTemperature(v3.x, v3.y, v3.z, heightOffset);
            const biomeColor = this.terrain.getBiomeColor(heightOffset, moisture, temperature);
            colors.push(biomeColor.r, biomeColor.g, biomeColor.b);
        }

        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        // Generate spherical UVs for terrain texture
        const uvs = [];
        for (let i = 0; i < positions.count; i++) {
            v3.set(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize();
            // Spherical UV mapping (longitude/latitude)
            const u = 0.5 + Math.atan2(v3.z, v3.x) / (2 * Math.PI);
            const vCoord = 0.5 + Math.asin(v3.y) / Math.PI;
            // Tile the texture for detail (adjustable via textureRepeat)
            const textureRepeat = 20; // Higher = more tiling
            uvs.push(u * textureRepeat, vCoord * textureRepeat);
        }
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        geometry.computeVertexNormals();

        // Load sand texture
        const textureLoader = new THREE.TextureLoader();
        const sandDiffuse = textureLoader.load('assets/textures/sand_1.png');
        const sandNormal = textureLoader.load('assets/textures/sand_1_normal.png');

        // Texture tiling settings
        sandDiffuse.wrapS = sandDiffuse.wrapT = THREE.RepeatWrapping;
        sandNormal.wrapS = sandNormal.wrapT = THREE.RepeatWrapping;

        const material = new THREE.MeshStandardMaterial({
            map: sandDiffuse,
            normalMap: sandNormal,
            normalScale: new THREE.Vector2(0.5, 0.5),
            vertexColors: true,
            roughness: 0.9,
            metalness: 0.05,
            flatShading: false
        });

        material.onBeforeCompile = (shader) => {
            shader.uniforms.uFogTexture = { value: null };
            shader.uniforms.uVisibleTexture = { value: null };
            shader.uniforms.uUVScale = { value: new THREE.Vector2(1, 1) };
            shader.uniforms.uUVOffset = { value: new THREE.Vector2(0, 0) };
            shader.uniforms.uDebugMode = { value: 0 };
            shader.uniforms.uFowColor = { value: new THREE.Color(0x000000) };
            shader.uniforms.uFowSmoothing = { value: 0.0 }; // 0.0 = OFF, >0.0 = Blur Radius

            // Tri-planar texturing uniforms
            shader.uniforms.uTextureScale = { value: 0.5 }; // World-space texture repeat
            shader.uniforms.uUseTriPlanar = { value: 1 }; // 1 = tri-planar, 0 = UV-based
            shader.uniforms.uBlendSharpness = { value: 2.0 }; // Higher = sharper blend between projections

            shader.fragmentShader = `
                uniform sampler2D uFogTexture;
                uniform sampler2D uVisibleTexture;
                uniform vec2 uUVScale;
                uniform vec2 uUVOffset;
                uniform int uDebugMode;
                uniform vec3 uFowColor;
                uniform float uTextureScale;
                uniform int uUseTriPlanar;
                uniform float uBlendSharpness;
                uniform float uFowSmoothing;

                // Smooth FOW sampling (3x3 Blur)
                vec4 sampleFowSmooth(sampler2D tex, vec2 uv) {
                    if (uFowSmoothing <= 0.01) return texture2D(tex, uv);

                    vec4 sum = vec4(0.0);
                    vec2 step = vec2(uFowSmoothing * 0.005); 

                    sum += texture2D(tex, uv + vec2(-step.x, -step.y)) * 1.0;
                    sum += texture2D(tex, uv + vec2(0.0,     -step.y)) * 2.0;
                    sum += texture2D(tex, uv + vec2(step.x,  -step.y)) * 1.0;
                    
                    sum += texture2D(tex, uv + vec2(-step.x, 0.0))     * 2.0;
                    sum += texture2D(tex, uv)                          * 4.0;
                    sum += texture2D(tex, uv + vec2(step.x,  0.0))     * 2.0;
                    
                    sum += texture2D(tex, uv + vec2(-step.x, step.y))  * 1.0;
                    sum += texture2D(tex, uv + vec2(0.0,     step.y))  * 2.0;
                    sum += texture2D(tex, uv + vec2(step.x,  step.y))  * 1.0;
                    
                    return sum / 16.0;
                }
                
                // Tri-planar sampling function
                vec4 triPlanarSample(sampler2D tex, vec3 worldPos, vec3 normal, float scale) {
                    // Blending weights based on normal direction
                    vec3 blending = pow(abs(normal), vec3(uBlendSharpness));
                    blending /= (blending.x + blending.y + blending.z);
                    
                    // Sample along each axis
                    vec4 xAxis = texture2D(tex, worldPos.yz * scale);
                    vec4 yAxis = texture2D(tex, worldPos.xz * scale);
                    vec4 zAxis = texture2D(tex, worldPos.xy * scale);
                    
                    // Blend samples
                    return xAxis * blending.x + yAxis * blending.y + zAxis * blending.z;
                }
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
                
                if (uDebugMode == 1) {
                    gl_FragColor = vec4(u, v, 0.0, 1.0);
                    return;
                }

                // Smooth sampling
                vec4 explored = sampleFowSmooth(uFogTexture, vec2(u, v));
                vec4 visible = sampleFowSmooth(uVisibleTexture, vec2(u, v));
                
                float isVisible = visible.r; 
                float isExplored = explored.r;
                
                if (uDebugMode == 2) {
                    gl_FragColor = vec4(isVisible, isExplored, 0.0, 1.0); 
                    return;
                }
                
                vec3 finalColor = gl_FragColor.rgb;
                
                if (isVisible > 0.1) {
                    // Visible - keep original water color
                } else if (isExplored > 0.1) {
                    // Explored but not visible - 50% darker, 50% desaturated
                    float gray = dot(finalColor, vec3(0.299, 0.587, 0.114));
                    vec3 desaturated = vec3(gray);
                    // 50% desaturation, 50% darkening
                    finalColor = mix(finalColor, desaturated, 0.5) * 0.5;
                } else {
                    // Unexplored terrain - SOLID BLACK (stars render on top)
                    finalColor = vec3(0.0, 0.0, 0.0);
                }
                
                gl_FragColor = vec4(finalColor, 1.0);
                #include <dithering_fragment>
                `
            );

            material.materialShader = shader;
        };

        return new THREE.Mesh(geometry, material);
    }

    regenerate() {
        const oldMesh = this.mesh;
        const oldWater = this.waterMesh;

        this.mesh = this.createMesh();
        this.mesh.receiveShadow = true; // CRITICAL: Enable shadow receiving
        this.waterMesh = this.createWaterMesh();

        if (oldMesh.parent) {
            oldMesh.parent.add(this.mesh);
            oldMesh.parent.remove(oldMesh);
        }

        if (oldWater && oldWater.parent) {
            oldWater.parent.add(this.waterMesh);
            oldWater.parent.remove(oldWater);
        }

        oldMesh.geometry.dispose();
        oldMesh.material.dispose();

        if (oldWater) {
            oldWater.geometry.dispose();
            oldWater.material.dispose();
        }
    }

    createStarField(count) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);

        // Place stars on terrain surface
        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const dir = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            );

            // Get terrain height and place star just above surface
            const terrainRadius = this.terrain.getRadiusAt(dir);
            const pos = dir.clone().multiplyScalar(terrainRadius + 0.1);

            positions[i * 3] = pos.x;
            positions[i * 3 + 1] = pos.y;
            positions[i * 3 + 2] = pos.z;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        // Custom shader material that reads FOW texture
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uFogTexture: { value: null },
                uStarSize: { value: 1.2 }
            },
            vertexShader: `
                uniform sampler2D uFogTexture;
                uniform float uStarSize;
                varying float vVisible;
                
                void main() {
                    // Calculate UV from position (spherical mapping)
                    vec3 dir = normalize(position);
                    float u = 0.5 + atan(dir.z, dir.x) / (2.0 * 3.14159265);
                    float v = 0.5 + asin(dir.y) / 3.14159265;
                    
                    // Read FOW texture - if explored, hide star
                    vec4 fog = texture2D(uFogTexture, vec2(u, v));
                    vVisible = 1.0 - fog.r; // visible if NOT explored
                    
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = uStarSize * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vVisible;
                
                void main() {
                    // Hide if explored
                    if (vVisible < 0.5) discard;
                    
                    // Soft circular star
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    
                    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * 0.9);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        const stars = new THREE.Points(geometry, material);
        stars.renderOrder = 10; // Render ABOVE terrain (black) so stars show

        console.log(`Created ${count} terrain stars (THREE.Points, FOW-aware)`);
        return stars;
    }

    getHeightAt(position) {
        return this.terrain.getRadiusAt(position.clone().normalize());
    }
}
