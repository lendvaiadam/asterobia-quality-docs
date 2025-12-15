import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';

export class RockMeshGenerator {
    constructor() {
        this.noise3D = createNoise3D();
        // Cache adjacency graphs by detail level/vertex count to optimize performance
        // Static cache to persist across instances
        if (!RockMeshGenerator.adjacencyCache) {
            RockMeshGenerator.adjacencyCache = {};
        }
    }

    /**
     * Generates a rock mesh using UV Sphere + Scrape + Noise algorithm (Reference: demo2).
     */
    generate(params = {}) {
        const {
            radius = 1,
            detail = 2, // Maps to width/height segments. 0=Low(8), 10=High(64)
            scrapeCount = 8,
            scrapeMinDist = 0.5,
            scrapeStrength = 0.4,
            scrapeRadius = 0.6,
            noiseScale = 1.0,
            noiseStrength = 0.1,
            scale = new THREE.Vector3(1, 1, 1),
            flatTop = false,
            flatTopRadius = 0.8
        } = params;

        // 1. Base Geometry: UV Sphere (THREE.SphereGeometry)
        // Detail parameter maps to segment count: 8 + detail * 4
        // e.g. Detail 0 -> 8x8, Detail 5 -> 28x28
        const segments = 12 + Math.floor(detail * 4); 
        const geometry = new THREE.SphereGeometry(radius, segments, segments);
        
        const posAttribute = geometry.attributes.position;
        const vertexCount = posAttribute.count;

        // 2. Build or Fetch Adjacency Graph (Cached)
        // Key: segment count (unique enough for this generator)
        const adjKey = segments;
        let adjacency = RockMeshGenerator.adjacencyCache[adjKey];
        if (!adjacency) {
            adjacency = this._buildAdjacency(geometry);
            RockMeshGenerator.adjacencyCache[adjKey] = adjacency;
        }

        // 3. Apply Scrapes (Flood Fill + Plane Projection)
        this._applyScrapes(posAttribute, adjacency, scrapeCount, scrapeMinDist, scrapeStrength, scrapeRadius, radius);

        // 4. Apply Flat Top
        if (flatTop) {
            this._applyFlatTop(posAttribute, adjacency, flatTopRadius, radius);
        }

        // 5. Apply Noise (Displacement along normal)
        this._applyNoise(posAttribute, noiseScale, noiseStrength);

        // 6. Apply Scale
        geometry.scale(scale.x, scale.y, scale.z);

        // 7. Recompute Normals for correct lighting
        geometry.computeVertexNormals();
        
        // 8. Update bounding info for accurate raycasting
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        
        // 9. Generate Vertex Colors (Procedural Palette)
        this._applyVertexColors(geometry, params);

        return { geometry, gameplayData: { standableTopCenter: new THREE.Vector3(0, scale.y * radius, 0) } };
    }

    /**
     * Builds adjacency graph (Neighbor List) with SPATIAL WELDING.
     * Merges vertices at the same position (like UV seams) to allow flood fill to cross them.
     */
    _buildAdjacency(geometry) {
        const indexAttribute = geometry.index;
        const posAttribute = geometry.attributes.position;
        const count = posAttribute.count;
        const tempPos = new THREE.Vector3();
        
        // 1. Identification: Map physical position string to a "Unique Logical Vertex ID"
        const posToLogicId = new Map();
        const realToLogicId = new Int32Array(count);
        let logicCount = 0;
        
        // Precision for hashing
        const prec = 10000; 
        
        for (let i = 0; i < count; i++) {
            tempPos.fromBufferAttribute(posAttribute, i);
            // Simple hash key
            const key = `${Math.round(tempPos.x * prec)},${Math.round(tempPos.y * prec)},${Math.round(tempPos.z * prec)}`;
            
            if (!posToLogicId.has(key)) {
                posToLogicId.set(key, logicCount++);
            }
            realToLogicId[i] = posToLogicId.get(key);
        }
        
        // 2. Build Adjacency for Logical IDs
        const adjSets = new Array(logicCount).fill(null).map(() => new Set());
        
        if (indexAttribute) {
            for (let i = 0; i < indexAttribute.count; i += 3) {
                // Get Real Indices
                const ra = indexAttribute.getX(i);
                const rb = indexAttribute.getX(i + 1);
                const rc = indexAttribute.getX(i + 2);
                
                // Get Logic Indices
                const a = realToLogicId[ra];
                const b = realToLogicId[rb];
                const c = realToLogicId[rc];
                
                if (a !== b) { adjSets[a].add(b); adjSets[b].add(a); }
                if (a !== c) { adjSets[a].add(c); adjSets[c].add(a); }
                if (b !== c) { adjSets[b].add(c); adjSets[c].add(b); }
            }
        }
        
        // 3. Map Logic ID back to all Real Indices (for applying deformation)
        const logicToReal = new Array(logicCount).fill(null).map(() => []);
        for (let i = 0; i < count; i++) {
            const lid = realToLogicId[i];
            logicToReal[lid].push(i);
        }
        
        return {
            neighbors: adjSets.map(set => Array.from(set)),
            logicToReal: logicToReal,
            realToLogic: realToLogicId,
            logicCount: logicCount
        };
    }

    /**
     * Scrape Algorithm (Modified for Logical Vertices)
     */
    _applyScrapes(posAttribute, adjacencyInfo, count, minDist, strength, radius, sphereRadius) {
        const { neighbors, logicToReal, realToLogic, logicCount } = adjacencyInfo;
        
        const scrapedIndices = []; // Stores LOGICAL indices
        const tempPos = new THREE.Vector3();
        const centerPos = new THREE.Vector3();
        
        // Helper to get position of a logical vertex (just take the first real one)
        const getLogicPos = (lid, target) => {
            const rid = logicToReal[lid][0];
            target.fromBufferAttribute(posAttribute, rid);
            return target;
        };
        
        for (let i = 0; i < count; i++) {
            let attempt = 0;
            let logicCenterIndex = -1;
            
            // Find valid center
            while (attempt < 50) {
                // Random LOGICAL index
                const randLid = Math.floor(Math.random() * logicCount);
                getLogicPos(randLid, tempPos);
                
                let tooClose = false;
                for (const existingLid of scrapedIndices) {
                    getLogicPos(existingLid, centerPos);
                    if (tempPos.distanceTo(centerPos) < minDist) {
                        tooClose = true;
                        break;
                    }
                }
                
                if (!tooClose) {
                    logicCenterIndex = randLid;
                    break;
                }
                attempt++;
            }
            
            if (logicCenterIndex !== -1) {
                scrapedIndices.push(logicCenterIndex);
                this._performSingleScrape(logicCenterIndex, posAttribute, adjacencyInfo, strength, radius);
            }
        }
    }
    
    _performSingleScrape(logicCenterIndex, posAttribute, adjacencyInfo, strength, radius, forcedNormal = null) {
        const { neighbors, logicToReal } = adjacencyInfo;
        
        const centerPos = new THREE.Vector3();
        // Get position from first real vertex of this logic group
        centerPos.fromBufferAttribute(posAttribute, logicToReal[logicCenterIndex][0]);
        
        const normal = forcedNormal || centerPos.clone().normalize();
        const r0 = centerPos.clone().addScaledVector(normal, -strength);
        
        // Flood Fill on LOGICAL graph
        const stack = [logicCenterIndex];
        const visited = new Set();
        visited.add(logicCenterIndex);
        
        const currentPos = new THREE.Vector3();
        const projectedVec = new THREE.Vector3();
        const radiusSq = radius * radius;
        
        while (stack.length > 0) {
            const lid = stack.pop();
            
            // Read position (from first real vert)
            currentPos.fromBufferAttribute(posAttribute, logicToReal[lid][0]);
            
            const diff = new THREE.Vector3().subVectors(currentPos, r0);
            const distToPlane = diff.dot(normal);
            
            projectedVec.copy(currentPos).addScaledVector(normal, -distToPlane);
            
            if (projectedVec.distanceToSquared(r0) < radiusSq) {
                // APPLY TO ALL REAL VERTICES for this logical ID
                const realIndices = logicToReal[lid];
                for (const rid of realIndices) {
                    posAttribute.setXYZ(rid, projectedVec.x, projectedVec.y, projectedVec.z);
                }
                
                // Add neighbors
                const myNeighbors = neighbors[lid];
                for (const nLid of myNeighbors) {
                    if (!visited.has(nLid)) {
                        visited.add(nLid);
                        stack.push(nLid);
                    }
                }
            }
        }
    }

    _applyFlatTop(posAttribute, adjacency, radius, sphereRadius) {
        // Find highest vertex
        let topIndex = -1;
        let maxY = -Infinity;
        const tempPos = new THREE.Vector3();
        
        // Heuristic: Check a subset or all? Checking all is cheap enough.
        for (let i = 0; i < posAttribute.count; i++) {
            tempPos.fromBufferAttribute(posAttribute, i);
            if (tempPos.y > maxY) {
                maxY = tempPos.y;
                topIndex = i;
            }
        }
        
        if (topIndex !== -1) {
            // Apply strong scrape from Top
            // Normal = (0, 1, 0)
            this._performSingleScrape(topIndex, posAttribute, adjacency, 0.3, radius, new THREE.Vector3(0, 1, 0));
        }
    }

    _applyNoise(posAttribute, scale, strength) {
        const vertexCount = posAttribute.count;
        const tempPos = new THREE.Vector3();
        const normal = new THREE.Vector3();
        
        for (let i = 0; i < vertexCount; i++) {
            tempPos.fromBufferAttribute(posAttribute, i);
            
            // Calculate noise
            const n = this.noise3D(
                tempPos.x * scale,
                tempPos.y * scale,
                tempPos.z * scale
            );
            
            // Displace along Normal
            // For a sphere centered at 0, Normal == Position Normalized
            normal.copy(tempPos).normalize();
            
            const displacement = strength * n;
            tempPos.addScaledVector(normal, displacement);
            
            posAttribute.setXYZ(i, tempPos.x, tempPos.y, tempPos.z);
        }
    }
    
    _applyVertexColors(geometry, params) {
        const count = geometry.attributes.position.count;
        const colors = new Float32Array(count * 3);
        const posAttribute = geometry.attributes.position;
        const tempPos = new THREE.Vector3();
        
        // Palette (Ethereal Rocks)
        const colorA = new THREE.Color(0x5a4d41); // Base Dark
        const colorB = new THREE.Color(0x8c7c6e); // Mid
        const colorC = new THREE.Color(0xb5a698); // Light
        
        const scale = 2.0; 
        
        for (let i = 0; i < count; i++) {
            tempPos.fromBufferAttribute(posAttribute, i);
            
            // 3D Noise for pattern
            const n = this.noise3D(tempPos.x * scale, tempPos.y * scale, tempPos.z * scale);
            const t = n * 0.5 + 0.5; // 0..1
            
            let finalColor;
            if (t < 0.5) {
                // Mix A and B
                // Remap t 0..0.5 to 0..1
                const localT = t * 2.0;
                finalColor = colorA.clone().lerp(colorB, localT);
            } else {
                // Mix B and C
                // Remap t 0.5..1 to 0..1
                const localT = (t - 0.5) * 2.0;
                finalColor = colorB.clone().lerp(colorC, localT);
            }
            
            colors[i * 3] = finalColor.r;
            colors[i * 3 + 1] = finalColor.g;
            colors[i * 3 + 2] = finalColor.b;
        }
        
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
}
