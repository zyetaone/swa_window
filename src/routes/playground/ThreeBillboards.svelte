<script lang="ts">
	/**
	 * ThreeBillboards — Three.js SpriteMarkers overlay via MapLibre's custom-layer API.
	 *
	 * MapLibre's custom-layer API (`{type: 'custom', onAdd, render}`) hands us the
	 * shared GL context. We attach a Three.js WebGLRenderer to the same canvas +
	 * context (NO new GL context), build a scene, and render on every MapLibre frame.
	 *
	 * Each landmark becomes a glowing Sprite — gold/silver/bronze by rank (1/2/3).
	 * Sprites always face the camera (billboard behavior), scale with distance
	 * automatically, and require no external assets.
	 *
	 * Proof-of-concept swap from the original glowing sphere.
	 */

	import maplibregl from 'maplibre-gl';
	import * as THREE from 'three';

	interface LandmarkSprite {
		feature: GeoJSON.Feature<GeoJSON.Point, { id: string; name: string; rank: 1 | 2 | 3; category: string }>;
		sprite: THREE.Sprite;
	}

	let {
		map,
		locationId = '',
		landmarks = [],
	}: {
		map: maplibregl.Map | undefined;
		locationId?: string;
		landmarks?: GeoJSON.Feature<GeoJSON.Point, { id: string; name: string; rank: 1 | 2 | 3; category: string }>[];
	} = $props();

	// Rank → color mapping
	const RANK_COLOR: Record<1 | 2 | 3, string> = {
		1: '#ffd700', // gold — hero landmark
		2: '#c0c0c0', // silver — secondary
		3: '#cd7f32', // bronze — tertiary
	};
	const RANK_SCALE: Record<1 | 2 | 3, number> = { 1: 1.0, 2: 0.65, 3: 0.45 };

	function makeSpriteMaterial(color: string): THREE.SpriteMaterial {
		const c = new THREE.Color(color);
		// Glowing halo — inner bright core, outer fade
		return new THREE.SpriteMaterial({
			map: makeGlowTexture(c),
			transparent: true,
			depthTest: false,       // always on top
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			opacity: 0.85,
		});
	}

	function makeGlowTexture(color: THREE.Color): THREE.Texture {
		const size = 128;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d')!;

		const cx = size / 2;
		const cy = size / 2;
		const r = size / 2;

		// Radial gradient: bright core → transparent edge
		const grd = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
		grd.addColorStop(0,    `rgba(${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)},1.0)`);
		grd.addColorStop(0.25, `rgba(${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)},0.7)`);
		grd.addColorStop(0.6,  `rgba(${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)},0.25)`);
		grd.addColorStop(1,    'rgba(0,0,0,0)');

		ctx.clearRect(0, 0, size, size);
		ctx.fillStyle = grd;
		ctx.fillRect(0, 0, size, size);

		const tex = new THREE.CanvasTexture(canvas);
		tex.needsUpdate = true;
		return tex;
	}

	$effect(() => {
		if (!map) return;
		console.log('[ThreeBillboards] mapRef available, preparing layer...');

		let isActive = true;
		const MARKER_ALTITUDE = 500; // meters above terrain

		const customLayer = {
			id: 'three-billboards',
			type: 'custom' as const,
			renderingMode: '3d' as const,

			scene: new THREE.Scene(),
			camera: new THREE.Camera(),
			renderer: null as THREE.WebGLRenderer | null,
			sprites: [] as LandmarkSprite[],

			onAdd(mapInstance: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
				const ambient = new THREE.AmbientLight(0xffffff, 0.6);
				this.scene.add(ambient);
				const dir = new THREE.DirectionalLight(0xffffff, 0.8);
				dir.position.set(0, 70, 100).normalize();
				this.scene.add(dir);

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
				map.triggerRepaint();
			},

			onRemove() {
				for (const { sprite } of this.sprites) {
					(sprite.material as THREE.Material)?.dispose();
					if (sprite.material.map) (sprite.material.map as THREE.Texture)?.dispose();
				}
				this.scene.clear();
			},
		};

		const tryAdd = () => {
			if (!isActive || !map) return;
			try {
				if (map.getLayer('three-billboards')) return;
				if (!map.isStyleLoaded()) { setTimeout(tryAdd, 200); return; }
				map.addLayer(customLayer as any);
				console.log('[ThreeBillboards] layer added');
			} catch (e) {
				console.warn('[ThreeBillboards] addLayer failed:', e);
				setTimeout(tryAdd, 400);
			}
		};
		tryAdd();

		// Rebuild sprites whenever location changes
		$effect(() => {
			const locId = locationId;
			const feats = landmarks;
			if (!customLayer.renderer || !feats.length) return;

			// Remove old sprites
			for (const { sprite } of customLayer.sprites) {
				customLayer.scene.remove(sprite);
			}
			customLayer.sprites = [];

			// Add one sprite per landmark
			for (const feature of feats) {
				const [lon, lat] = feature.geometry.coordinates;
				const rank: 1 | 2 | 3 = feature.properties.rank;
				const color = RANK_COLOR[rank];
				const scale = RANK_SCALE[rank];

				const origin = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], MARKER_ALTITUDE);
				const mPerUnit = origin.meterInMercatorCoordinateUnits();
				const spriteSize = 800 * scale * mPerUnit; // 800m base size × rank scale

				const mat = makeSpriteMaterial(color);
				const sprite = new THREE.Sprite(mat);
				sprite.position.set(origin.x, origin.y, origin.z);
				sprite.scale.setScalar(spriteSize);

				customLayer.scene.add(sprite);
				customLayer.sprites.push({ feature, sprite });
			}

			console.log(`[ThreeBillboards] ${customLayer.sprites.length} sprites for location "${locId}"`);
		});

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
