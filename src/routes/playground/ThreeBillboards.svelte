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

	import { onDestroy } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import * as THREE from 'three';

	let { map, lon = 55.3, lat = 25.2, altitude = 8000, radius = 12000, color = '#ffd880' }: {
		map: maplibregl.Map | undefined;
		lon?: number;
		lat?: number;
		altitude?: number;
		/** Sphere radius in meters. 12km is big but visible at cruise zoom. */
		radius?: number;
		color?: string;
	} = $props();

	let customLayer: any = null;
	let attached = $state(false);

	$effect(() => {
		if (!map || attached) return;
		console.log('[ThreeBillboards] mapRef available, preparing layer...');

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

				// Mercator-coordinate-space model transform. Synchronous import
				// at top ensures the sphere is positioned BEFORE first render().
				this.modelOrigin = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], altitude);
				const scale = this.modelOrigin.meterInMercatorCoordinateUnits();
				const r = radius * scale;
				this.mesh!.scale.setScalar(r);
				this.mesh!.position.set(this.modelOrigin.x, this.modelOrigin.y, this.modelOrigin.z);
				console.log('[ThreeBillboards] sphere at', { x: this.modelOrigin.x, y: this.modelOrigin.y, z: this.modelOrigin.z, r });

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
			if (!map) return;
			try {
				if (map.getLayer('three-billboards')) { attached = true; return; }
				if (!map.isStyleLoaded()) {
					setTimeout(tryAdd, 200);
					return;
				}
				map.addLayer(customLayer);
				attached = true;
				console.log('[ThreeBillboards] layer added');
			} catch (e) {
				console.warn('[ThreeBillboards] addLayer failed:', e);
				setTimeout(tryAdd, 400);
			}
		};
		tryAdd();
	});

	onDestroy(() => {
		try {
			if (map?.getLayer('three-billboards')) map.removeLayer('three-billboards');
		} catch {}
	});
</script>
