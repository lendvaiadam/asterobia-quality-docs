import * as THREE from 'three';

export class FogOfWar {
    constructor(renderer, planetRadius) {
        this.renderer = renderer;
        this.planetRadius = planetRadius;
        this.resolution = 4096; // Increased from 2048 for better edge quality
        this.currentVisionRadius = 10.0; // Default vision radius
        
        // Render Targets
        this.exploredTarget = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType
        });
        
        this.visibleTarget = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType
        });
        
        // Scene
        this.fowScene = new THREE.Scene();
        this.fowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        // Brush Material (Shader)
        // Calculates exact 3D distance on sphere surface
        this.brushMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uUnitPosition: { value: new THREE.Vector3() },
                uVisionRadius: { value: 5.0 },
                uPlanetRadius: { value: planetRadius }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uUnitPosition;
                uniform float uVisionRadius;
                uniform float uPlanetRadius;
                varying vec2 vUv;
                
                #define PI 3.14159265359
                
                void main() {
                    // Convert UV to 3D Direction (Equirectangular Inverse)
                    // u = 0.5 + atan(z, x) / 2pi
                    // v = 0.5 + asin(y) / pi
                    
                    // Reverse:
                    // asin(y) = (v - 0.5) * pi => y = sin((v - 0.5) * pi)
                    // atan(z, x) = (u - 0.5) * 2pi => theta
                    
                    float theta = (vUv.x - 0.5) * 2.0 * PI;
                    float phi = (vUv.y - 0.5) * PI;
                    
                    float y = sin(phi);
                    float r = cos(phi); // Radius of the slice at height y
                    float x = r * cos(theta);
                    float z = r * sin(theta);
                    
                    vec3 pixelDir = normalize(vec3(x, y, z));
                    vec3 unitDir = normalize(uUnitPosition);
                    
                    // Calculate Angle between vectors
                    float dotProd = dot(pixelDir, unitDir);
                    // Clamp to handle float errors
                    dotProd = clamp(dotProd, -1.0, 1.0);
                    
                    float angle = acos(dotProd);
                    float dist = angle * uPlanetRadius;
                    
                    // Soft edge
                    // User Request: Higer Contrast (Darker darks, lighter lights)
                    // We sharpen the edge by reducing the smoothstep range
                    // Original: uVisionRadius * 0.8 to uVisionRadius (20% fade)
                    // New: uVisionRadius * 0.95 to uVisionRadius (5% fade = sharper transition)
                    
                    float alpha = 1.0 - smoothstep(uVisionRadius * 0.95, uVisionRadius, dist);
                    
                    // Boost alpha to ensure full white in center? It's already 1.0.
                    // To make "Darker Darks", we rely on the implementation where alpha=0 is dark.
                    
                    gl_FragColor = vec4(alpha, alpha, alpha, 1.0);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false
        });
        
        // Reusable Quad Mesh (Full Screen for now to be safe against distortion)
        // Optimization: We could use a smaller quad centered on the unit UV, 
        // but we'd need to handle the wrapping at the date line and poles.
        // For < 50 units, full screen quads are likely fine on modern GPUs.
        this.quadGeometry = new THREE.PlaneGeometry(2, 2); 
    }
    
    update(units) {
        // 1. Clear Visible Target
        this.renderer.setRenderTarget(this.visibleTarget);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear();
        
        // 2. Render Brushes
        // We render directly to the target.
        // Since we are using a full-screen quad for each unit, we can just draw the mesh N times.
        
        // We need to use the scene/camera to render.
        
        // Clear scene
        while(this.fowScene.children.length > 0){ 
            this.fowScene.remove(this.fowScene.children[0]); 
        }
        
        // Add a quad for each unit
        units.forEach(unit => {
            if (!unit) return; // Skip null units (not yet loaded)
            const mesh = new THREE.Mesh(this.quadGeometry, this.brushMaterial.clone());
            mesh.material.uniforms.uUnitPosition.value.copy(unit.position);
            mesh.material.uniforms.uVisionRadius.value = this.currentVisionRadius || 15.0;
            mesh.material.uniforms.uPlanetRadius.value = this.planetRadius;
            this.fowScene.add(mesh);
        });
        
        // Render Visible
        // We use Normal Blending for Visible? 
        // Actually, if multiple units overlap, we want the UNION of their vision.
        // Max blending is best. Additive works if we clamp.
        // Let's use Additive and rely on clamp in the texture read.
        
        this.renderer.render(this.fowScene, this.fowCamera);
        
        // 3. Update Explored (Accumulate)
        this.renderer.setRenderTarget(this.exploredTarget);
        this.renderer.autoClear = false;
        this.renderer.render(this.fowScene, this.fowCamera);
        this.renderer.autoClear = true;
        
        this.renderer.setRenderTarget(null);
    }

    setVisionRadius(radius) {
        this.currentVisionRadius = radius;
    }

    setResolution(newResolution) {
        this.resolution = newResolution;
        
        // Recreate render targets
        this.exploredTarget.dispose();
        this.visibleTarget.dispose();
        
        this.exploredTarget = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType
        });
        
        this.visibleTarget = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType
        });
    }

    createDebugSprite(scene) {
        const material = new THREE.SpriteMaterial({ 
            map: this.exploredTarget.texture,
            color: 0xffffff
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(15, 15, 0); // Top right corner roughly? No, world space.
        // Put it near the planet but visible
        sprite.scale.set(10, 10, 1);
        scene.add(sprite);
        this.debugSprite = sprite;
    }
}
