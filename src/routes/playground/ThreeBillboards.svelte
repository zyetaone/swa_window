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

	$effect(() => {
		if (!map) return;
		console.log('[ThreeBillboards] mapRef available, preparing layer...');

		// Flag to handle asynchronous setTimeouts if the component unmounts before map loads style
		let isActive = true;
		
		const customLayer = {
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

				this.modelOrigin = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], altitude);
				const scale = this.modelOrigin.meterInMercatorCoordinateUnits();
				const r = radius * scale;
				this.mesh!.scale.setScalar(r);
				this.mesh!.position.set(this.modelOrigin.x, this.modelOrigin.y, this.modelOrigin.z);
				console.log('[ThreeBillboards] sphere at', { x: this.modelOrigin.x, y: this.modelOrigin.y, z: this.modelOrigin.z, r });

				this.renderer = new THREE.WebGLRenderer({
					canvas: mapInstance.getCanvas(),
					context: gl as WebGL2RenderingContext,
					antialias: true,
				});
				this.renderer.autoClear = false;
			},

			render(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: number[]) {
				if (!this.renderer) return;
				this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);
				this.renderer.resetState();
				this.renderer.render(this.scene, this.camera);
				map.triggerRepaint(); // Re-trigger repaint to keep Three.js animated
			},

			onRemove() {
				this.mesh?.geometry.dispose();
				(this.mesh?.material as THREE.Material)?.dispose();
				this.scene.clear();
			},
		};

		const tryAdd = () => {
			if (!isActive || !map) return;
			try {
				if (map.getLayer('three-billboards')) return;
				if (!map.isStyleLoaded()) {
					setTimeout(tryAdd, 200);
					return;
				}
				map.addLayer(customLayer);
				console.log('[ThreeBillboards] layer added');
			} catch (e) {
				console.warn('[ThreeBillboards] addLayer failed:', e);
				setTimeout(tryAdd, 400);
			}
		};
		tryAdd();

		// Svelte 5 teardown runs when `map` changes or the component is destroyed.
		return () => {
			isActive = false;
			try {
				if (map?.getLayer('three-billboards')) {
					map.removeLayer('three-billboards');
					console.log('[ThreeBillboards] layer removed');
				}
			} catch (e) {
				console.warn('[ThreeBillboards] Cleanup failed:', e);
			}
		};
	});
</script>
