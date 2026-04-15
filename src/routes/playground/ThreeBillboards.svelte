<script lang="ts">
	/**
	 * ThreeBillboards — Three.js overlay rendered into MapLibre's WebGL context.
	 *
	 * Architecture: MapLibre's custom-layer API (`{type: 'custom', onAdd, render}`)
	 * hands us the shared GL context. We attach a Three.js WebGLRenderer to the
	 * same canvas + context (NO new GL context), build a scene, and render on
	 * every MapLibre frame. Camera projection matches by feeding MapLibre's
	 * per-frame projection matrix into a THREE.Matrix4.
	 *
	 * Proof-of-concept: a 20km-radius glowing sphere anchored at lon/lat/alt.
	 * Next iteration: swap the sphere for a SpriteMaterial + PNG texture atlas
	 * (AI-generated volumetric clouds, landmark badges, Southwest brand ornaments).
	 *
	 * See MapLibre's custom-layer docs:
	 *   https://maplibre.org/maplibre-gl-js/docs/API/classes/CustomLayerInterface/
	 */

	import { onMount, onDestroy } from 'svelte';
	import type maplibregl from 'maplibre-gl';
	import * as THREE from 'three';

	let { map, lon = 55.3, lat = 25.2, altitude = 500, color = '#ffd880' }: {
		map: maplibregl.Map | undefined;
		lon?: number;
		lat?: number;
		altitude?: number;
		color?: string;
	} = $props();

	let customLayer: any = null;

	onMount(() => {
		if (!map) return;

		customLayer = {
			id: 'three-billboards',
			type: 'custom' as const,
			renderingMode: '3d' as const,

			scene: new THREE.Scene(),
			camera: new THREE.Camera(),
			renderer: null as THREE.WebGLRenderer | null,
			mesh: null as THREE.Mesh | null,
			modelOrigin: null as any,
			modelMatrix: new THREE.Matrix4(),

			onAdd(mapInstance: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
				// Build scene — one light + one emissive sphere
				const ambient = new THREE.AmbientLight(0xffffff, 0.6);
				this.scene.add(ambient);
				const dir = new THREE.DirectionalLight(0xffffff, 0.8);
				dir.position.set(0, 70, 100).normalize();
				this.scene.add(dir);

				const geo = new THREE.SphereGeometry(1, 32, 16);
				const mat = new THREE.MeshStandardMaterial({
					color,
					emissive: color,
					emissiveIntensity: 0.4,
					transparent: true,
					opacity: 0.85,
				});
				this.mesh = new THREE.Mesh(geo, mat);
				this.scene.add(this.mesh);

				// Mercator-coordinate-space model transform. This is the standard
				// recipe for sharing GL state between MapLibre and Three.js.
				// Dynamic import: svelte-maplibre-gl doesn't globally expose maplibregl.
				import('maplibre-gl').then(ml => {
					this.modelOrigin = ml.MercatorCoordinate.fromLngLat([lon, lat], altitude);
					const scale = this.modelOrigin.meterInMercatorCoordinateUnits();
					// 5000m sphere — visible at cruise altitude, not obtrusive
					const radius = 5000 * scale;
					this.mesh!.scale.setScalar(radius);
					this.mesh!.position.set(this.modelOrigin.x, this.modelOrigin.y, this.modelOrigin.z);
				});

				// Attach Three.js renderer to the SAME canvas + context
				this.renderer = new THREE.WebGLRenderer({
					canvas: mapInstance.getCanvas(),
					context: gl as WebGL2RenderingContext,
					antialias: true,
				});
				this.renderer.autoClear = false;
			},

			render(_gl: any, matrix: number[]) {
				if (!this.renderer) return;
				// Feed MapLibre's per-frame projection matrix directly to the camera.
				this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);
				this.renderer.resetState();
				this.renderer.render(this.scene, this.camera);
				// Request another frame — MapLibre won't know we're animating
				map?.triggerRepaint();
			},

			onRemove() {
				this.mesh?.geometry.dispose();
				(this.mesh?.material as THREE.Material)?.dispose();
				this.scene.clear();
				// NB: do NOT dispose the renderer — it shares MapLibre's context
			},
		};

		const tryAdd = () => {
			try {
				if (map!.getLayer('three-billboards')) return;
				map!.addLayer(customLayer);
			} catch (e) {
				console.warn('[ThreeBillboards] addLayer failed:', e);
			}
		};
		if (map.isStyleLoaded()) tryAdd();
		else map.once('load', tryAdd);
	});

	onDestroy(() => {
		try {
			if (map?.getLayer('three-billboards')) map.removeLayer('three-billboards');
		} catch {}
	});
</script>
