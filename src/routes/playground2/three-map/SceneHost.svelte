<script lang="ts">
	/**
	 * SceneHost — wraps @dvt3d/maplibre-three-plugin's MapScene so our
	 * Three.js feature-class meshes share MapLibre's GL context.
	 *
	 * Architecture (first spike, artwork-abstraction path):
	 *   MapLibre (globe, tiles, camera, GeoJSON source)
	 *     │
	 *     └── MapScene (single Three.js CustomLayer, one renderer)
	 *           ├── WaterFeatureMesh    ← this commit
	 *           ├── LandFeatureMesh     ← next commit
	 *           └── BuildingsFeatureMesh ← after that
	 *
	 * The plugin handles:
	 *   - Camera sync from MapLibre → Three.js camera each frame
	 *   - Y-axis flip and mercator scale
	 *   - One shared WebGLRenderer so feature layers never stomp each
	 *     other's GL state (the playground2 ThrelteScene conflict).
	 *   - renderer.resetState() before every render (gotcha from MapLibre
	 *     custom-layer example).
	 *
	 * We take map as a prop (MapLibreCell exposes it via $bindable) and
	 * only initialise once the style has loaded — otherwise querySourceFeatures
	 * returns nothing and the camera matrix isn't ready.
	 */

	import { onDestroy } from 'svelte';
	import { MapScene } from '@dvt3d/maplibre-three-plugin';
	import * as THREE from 'three';
	import type maplibregl from 'maplibre-gl';
	import { sceneState } from '../lib/scene-state.svelte';
	import { sunVectorForSky } from '../lib/sun.svelte';
	import {
		createWaterMaterial,
		buildWaterGroup,
		DUBAI_GULF_SAMPLE,
	} from './water-mesh';

	interface Props {
		map: maplibregl.Map;
		/** Turn the water feature layer on/off. */
		showWater?: boolean;
	}

	let { map, showWater = true }: Props = $props();

	// MapScene instance lives for the lifetime of this component.
	// The plugin expects an IMap-ish shape; MapLibre's map satisfies it
	// via duck-typing (transform, getCanvas, addLayer, etc.).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const mapScene = new MapScene(map as any, {
		enablePostProcessing: false, // no bloom yet — land later
	});

	// Shared water material — u_time advances via requestAnimationFrame.
	const waterMaterial = createWaterMaterial();

	// Water feature group — mounted/unmounted based on showWater.
	let waterGroup: THREE.Group | null = null;

	function mountWater() {
		if (waterGroup) return;
		waterGroup = buildWaterGroup(DUBAI_GULF_SAMPLE, waterMaterial);
		// mapScene.addObject expects either IObject3D or a plain Object3D;
		// a Group qualifies via Object3D.
		mapScene.addObject(waterGroup);
	}
	function unmountWater() {
		if (!waterGroup) return;
		mapScene.removeObject(waterGroup);
		waterGroup = null;
	}

	$effect(() => {
		if (showWater) mountWater();
		else unmountWater();
	});

	// Per-frame uniform update. u_time drives the scrolling normals;
	// u_sunDir pulls from the shared sceneState via our sun helper.
	let rafId = 0;
	let startTime = performance.now();
	function tick() {
		const now = performance.now();
		const t = (now - startTime) / 1000;
		const u = waterMaterial.uniforms;
		u.u_time.value = t;
		const sun = sunVectorForSky(sceneState.timeOfDay, sceneState.lat);
		u.u_sunDir.value.copy(sun);
		rafId = requestAnimationFrame(tick);
	}
	rafId = requestAnimationFrame(tick);

	onDestroy(() => {
		cancelAnimationFrame(rafId);
		unmountWater();
		waterMaterial.dispose();
		// MapScene teardown — the plugin wires itself into MapLibre as a
		// custom layer; removing the map will GC it, but calling the
		// camera sync dispose explicitly frees the event handlers.
		try {
			mapScene.cameraSync.dispose();
		} catch {
			/* best effort */
		}
	});
</script>
