<script lang="ts">
/**
 * LandscapeAbstractionLayer — ThreeJS artwork filter composition inside MapLibre.
 *
 * It uses MapLibre's CustomLayerInterface to mount a WebGLRenderer directly
 * over MapLibre's globe. It queries visible MapLibre features (water),
 * converts their GeoJSON coordinates into Three.js geometries, and paints them
 * using stylized artwork shaders.
 */

import { onMount, onDestroy } from 'svelte';
import maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { sceneState } from '../lib/scene-state.svelte';
import { sunVectorForSky } from '../lib/sun.svelte';

let {
    map,
    waterBaseRgb = [0.15, 0.32, 0.45] as [number, number, number],
}: {
    map: maplibregl.Map;
    waterBaseRgb?: [number, number, number];
} = $props();

const scene = new THREE.Scene();
const camera = new THREE.Camera();
let renderer: THREE.WebGLRenderer | null = null;
let meshes: THREE.Mesh[] = [];

// Environmental lighting for physical materials
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 2.5);
scene.add(sunLight);

$effect(() => {
    // Keep sun synchronized with SSOT. Custom layer doesn't use Threlte's loop
    // natively for state syncing unless driven by Svelte.
    const sunDir = sunVectorForSky(sceneState.timeOfDay, sceneState.lat);
    sunLight.position.copy(sunDir);
});

const clock = new THREE.Clock();

// Load water normal map
const textureLoader = new THREE.TextureLoader();
const waterNormalTex = textureLoader.load('/textures/water-normals.jpg');
waterNormalTex.wrapS = THREE.RepeatWrapping;
waterNormalTex.wrapT = THREE.RepeatWrapping;

// Artwork shader placeholder for water
const waterMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(waterBaseRgb[0], waterBaseRgb[1], waterBaseRgb[2]),
    roughness: 0.15,
    metalness: 0.8,
    normalMap: waterNormalTex,
    normalScale: new THREE.Vector2(0.5, 0.5),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95
});

function drawFeatures() {
    if (!map) return;
    // Clear old meshes
    for (const mesh of meshes) {
        mesh.geometry.dispose();
        scene.remove(mesh);
    }
    meshes = [];

    const features = map.querySourceFeatures('openmaptiles', { sourceLayer: 'water' });

    // Deduplicate to avoid rendering overlapping water chunk borders
    const seenPolys = new Set<string>();

    for (const feat of features) {
        if (!feat.geometry) continue;

        const type = feat.geometry.type;
        let polys = [];
        
        if (type === 'Polygon') {
            polys = [feat.geometry.coordinates];
        } else if (type === 'MultiPolygon') {
            polys = feat.geometry.coordinates;
        } else {
            continue;
        }

        for (const poly of polys) {
            const extRing = poly[0];
            if (!extRing || extRing.length === 0) continue;
            
            const hash = `${extRing[0][0].toFixed(4)},${extRing[0][1].toFixed(4)}`;
            if (seenPolys.has(hash)) continue;
            seenPolys.add(hash);

            const shape = new THREE.Shape();
            
            for (let i = 0; i < extRing.length; i++) {
                const coord = maplibregl.MercatorCoordinate.fromLngLat([extRing[i][0], extRing[i][1]]);
                if (i === 0) {
                    shape.moveTo(coord.x, coord.y);
                } else {
                    shape.lineTo(coord.x, coord.y);
                }
            }

            for (let i = 1; i < poly.length; i++) {
                const holeRing = poly[i];
                if (!holeRing || holeRing.length === 0) continue;
                const holePath = new THREE.Path();
                for (let j = 0; j < holeRing.length; j++) {
                    const coord = maplibregl.MercatorCoordinate.fromLngLat([holeRing[j][0], holeRing[j][1]]);
                    if (j === 0) holePath.moveTo(coord.x, coord.y);
                    else holePath.lineTo(coord.x, coord.y);
                }
                shape.holes.push(holePath);
            }

            const geometry = new THREE.ShapeGeometry(shape);
            const mesh = new THREE.Mesh(geometry, waterMaterial);
            // Translate the mesh so that raycasting/depth works correctly. The Custom Layer projection
            // puts the globe surface near Z=0 in the model matrix. 
            // The water should be perfectly flush with the globe sea level.
            scene.add(mesh);
            meshes.push(mesh);
        }
    }
}

const implementation = {
    id: 'landscape-abstraction-3d',
    type: 'custom' as const,
    renderingMode: '3d' as const,
    onAdd(m: maplibregl.Map, gl: WebGLRenderingContext) {
        renderer = new THREE.WebGLRenderer({
            canvas: m.getCanvas(),
            context: gl as WebGL2RenderingContext,
            antialias: true,
        });
        renderer.autoClear = false;
        drawFeatures();
    },
    render(_gl: WebGLRenderingContext, args: unknown) {
        // MapLibre 5.x passes CustomRenderMethodInput; older APIs passed a raw matrix array.
        const matrix: number[] = Array.isArray(args)
            ? (args as number[])
            : Array.from(((args as { defaultProjectionData: { mainMatrix: ArrayLike<number> } }).defaultProjectionData.mainMatrix));
        if (!renderer) return;

        const time = clock.getElapsedTime();
        if (waterMaterial.normalMap) {
            waterMaterial.normalMap.offset.x = time * 0.01;
            waterMaterial.normalMap.offset.y = time * 0.015;
        }

        camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);
        // Sync map zoom to camera FOV/scaling (matrix gives raw 1.0 unit Mercator mapping)
        renderer.resetState();
        renderer.render(scene, camera);
        map.triggerRepaint();
    },
    onRemove() {
        for (const mesh of meshes) {
            mesh.geometry.dispose();
            scene.remove(mesh);
        }
        meshes = [];
        renderer?.dispose();
    },
};

onMount(() => {
    // We must ensure the style is loaded before adding a layer.
    if (map.isStyleLoaded()) {
        // Need to add vector source if not exists
        if (!map.getSource('openmaptiles')) {
            map.addSource('openmaptiles', {
                type: 'vector',
                url: 'https://tiles.openfreemap.org/planet'
            });
        }
        if (!map.getLayer('water-dummy')) {
            map.addLayer({
                id: 'water-dummy',
                type: 'fill',
                source: 'openmaptiles',
                'source-layer': 'water',
                paint: { 'fill-opacity': 0 }
            });
        }
        map.addLayer(implementation);
    } else {
        map.once('idle', () => {
			if (!map.getSource('openmaptiles')) {
				map.addSource('openmaptiles', {
					type: 'vector',
					url: 'https://tiles.openfreemap.org/planet'
				});
			}
            if (!map.getLayer('water-dummy')) {
                map.addLayer({
                    id: 'water-dummy',
                    type: 'fill',
                    source: 'openmaptiles',
                    'source-layer': 'water',
                    paint: { 'fill-opacity': 0 }
                });
            }
            map.addLayer(implementation);
        });
    }

	map.on('sourcedata', (e) => {
		if (e.sourceId === 'openmaptiles') {
			drawFeatures();
		}
	});
});

onDestroy(() => {
    if (map && map.getLayer('landscape-abstraction-3d')) {
        map.removeLayer('landscape-abstraction-3d');
    }
});
</script>
