<script lang="ts">
/**
 * LandscapeAbstractionLayer — ThreeJS artwork filter composition inside MapLibre.
 *
 * This layer extracts GeoJSON data from MapLibre's vector tiles and renders 
 * it as a physical Three.js model with "paper-cut" tactile depth.
 */
import { onMount, onDestroy } from 'svelte';
import maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { pg, getSunDirection } from '../lib/playground-state.svelte';


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

// Materials
let waterMaterial: THREE.MeshStandardMaterial;
let vegetationMaterial: THREE.MeshStandardMaterial;
let urbanMaterial: THREE.MeshStandardMaterial;
let naturalMaterial: THREE.MeshStandardMaterial;

const timer = new THREE.Timer();
const textureLoader = new THREE.TextureLoader();
const waterNormalTex = textureLoader.load('/textures/water-normals.jpg');
waterNormalTex.wrapS = THREE.RepeatWrapping;
waterNormalTex.wrapT = THREE.RepeatWrapping;
waterNormalTex.repeat.set(50000, 50000);

// Initialize materials
$effect(() => {
	waterMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color(waterBaseRgb[0], waterBaseRgb[1], waterBaseRgb[2]),
		roughness: 0.15,
		metalness: 0.8,
		normalMap: waterNormalTex,
		normalScale: new THREE.Vector2(0.3, 0.3),
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.9,
	});

	vegetationMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color(0.25, 0.38, 0.28), // Sage/Deep Green
		roughness: 0.85,
		metalness: 0.05,
		side: THREE.DoubleSide,
	});

	urbanMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color(0.28, 0.3, 0.38), // Slate Gray-Blue
		roughness: 0.4,
		metalness: 0.2,
		side: THREE.DoubleSide,
	});

	naturalMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color(0.55, 0.48, 0.38), // Earthy Ochre
		roughness: 0.9,
		metalness: 0.0,
		side: THREE.DoubleSide,
	});
});

// Environmental lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 2.2);
scene.add(sunLight);

$effect(() => {
	void pg.timeOfDay;
	const sunDir = getSunDirection();
	sunLight.position.copy(sunDir);
});

const getLayerConfig = (featClass: string, sourceLayer: string) => {
	if (sourceLayer === 'water' || featClass === 'water') {
		return { material: waterMaterial, z: 0 };
	}
	if (['wood', 'forest', 'grass', 'park', 'meadow', 'scrub'].includes(featClass)) {
		return { material: vegetationMaterial, z: 2 };
	}
	if (['residential', 'commercial', 'industrial', 'retail', 'major_road'].includes(featClass)) {
		return { material: urbanMaterial, z: 3 };
	}
	if (['sand', 'rock', 'bare_rock', 'beach'].includes(featClass)) {
		return { material: naturalMaterial, z: 1 };
	}
	return null;
};

function drawFeatures() {
	if (!map || !waterMaterial) return;
	
	// Dispose old geometry
	for (const mesh of meshes) {
		mesh.geometry.dispose();
		scene.remove(mesh);
	}
	meshes = [];

	const seenPolys = new Set<string>();

	const layers = [
		{ id: 'water', source: 'water' },
		{ id: 'landcover', source: 'landcover' },
		{ id: 'landuse', source: 'landuse' },
		{ id: 'park', source: 'park' }
	];

	for (const layer of layers) {
		const features = map.querySourceFeatures('openmaptiles', { sourceLayer: layer.source });
		
		for (const feat of features) {
			if (!feat.geometry) continue;

			const featClass = (feat.properties?.class as string) || layer.id;
			const config = getLayerConfig(featClass, layer.source);
			if (!config) continue;

			const type = feat.geometry.type;
			let polys = [];
			if (type === 'Polygon') polys = [feat.geometry.coordinates];
			else if (type === 'MultiPolygon') polys = feat.geometry.coordinates;
			else continue;

			for (const poly of polys) {
				const ring = poly[0];
				if (!ring || ring.length < 3) continue;

				// Hash based on first point and class
				const hash = `${featClass}-${ring[0][0].toFixed(4)},${ring[0][1].toFixed(4)}`;
				if (seenPolys.has(hash)) continue;
				seenPolys.add(hash);

				const shape = new THREE.Shape();
				for (let i = 0; i < ring.length; i++) {
					const m = maplibregl.MercatorCoordinate.fromLngLat([ring[i][0], ring[i][1]]);
					if (i === 0) shape.moveTo(m.x, m.y);
					else shape.lineTo(m.x, m.y);
				}

				// Holes
				for (let i = 1; i < poly.length; i++) {
					const hRing = poly[i];
					if (!hRing || hRing.length < 0) continue;
					const hole = new THREE.Path();
					for (let j = 0; j < hRing.length; j++) {
						const m = maplibregl.MercatorCoordinate.fromLngLat([hRing[j][0], hRing[j][1]]);
						if (j === 0) hole.moveTo(m.x, m.y);
						else hole.lineTo(m.x, m.y);
					}
					shape.holes.push(hole);
				}

				const geo = new THREE.ShapeGeometry(shape);
				const mesh = new THREE.Mesh(geo, config.material);
				
				// Tactile offset ~ 50-150 meters
				mesh.position.z = config.z * 0.000006;
				
				scene.add(mesh);
				meshes.push(mesh);
			}
		}
	}
}

const customLayer = {
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
	render(_gl: WebGLRenderingContext, args: any) {
		const matrix = Array.isArray(args) ? args : args.defaultProjectionData.mainMatrix;
		if (!renderer) return;

		// Animate water
		if (waterMaterial?.normalMap) {
			timer.update();
			const t = timer.getElapsed();
			waterMaterial.normalMap.offset.set(t * 0.008, t * 0.012);
		}

		camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);
		renderer.resetState();
		renderer.render(scene, camera);
		map.triggerRepaint();
	},
	onRemove() {
		for (const m of meshes) m.geometry.dispose();
		renderer?.dispose();
	}
};

onMount(() => {
	const setup = () => {
		// Sources are now managed by the parent AeroViewport.
		['water', 'landcover', 'landuse', 'park'].forEach(l => {
			if (!map.getLayer(l + '-dummy')) {
				map.addLayer({ id: l + '-dummy', type: 'fill', source: 'openmaptiles', 'source-layer': l, paint: { 'fill-opacity': 0 } });
			}
		});
		map.addLayer(customLayer);
	};

	if (map.isStyleLoaded()) setup();
	else map.on('load', setup);

	let lastUpdate = 0;
	function throttledDraw() {
		const now = Date.now();
		if (now - lastUpdate < 500) return;
		lastUpdate = now;
		drawFeatures();
	}

	map.on('moveend', throttledDraw);
	map.on('sourcedata', (e) => {
		if (e.sourceId === 'openmaptiles') throttledDraw();
	});

	$effect(() => {
		// Re-draw when location changes explicitly
		void pg.activeLocation;
		throttledDraw();
	});
});

onDestroy(() => {
	if (map && map.getLayer(customLayer.id)) map.removeLayer(customLayer.id);
});
</script>
