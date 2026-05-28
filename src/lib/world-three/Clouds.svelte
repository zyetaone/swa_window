<script lang="ts">
	/**
	 * Clouds — PNG-sprite CLUSTER composition at the WGS84 cloud deck.
	 *
	 * Mirrors the production ArtsyClouds technique
	 * (src/lib/scene/effects/clouds/ArtsyClouds.svelte): each cloud is a
	 * CLUSTER of 5-12 sprites stacked with random offset, scale, rotation,
	 * brightness, and opacity. The cluster reads as one volumetric cloud;
	 * collections of clusters at varied altitudes form the cloud deck.
	 * Single-sprite clouds are deliberately rare (≤ 8 %) so the deck never
	 * reads as a scatter of identical puffs.
	 *
	 * Built imperatively (THREE.Sprite + per-sprite SpriteMaterial) so we
	 * can animate per-sprite material.rotation in useTask without a 100-
	 * way reactive prop binding. The whole cluster set sits inside a
	 * driftGroup that slowly rotates around the city's vertical axis for
	 * wind drift. The driftGroup itself sits inside an anchorGroup whose
	 * matrix is an ENU basis at the city's lat/lon — same convention as
	 * OsmBuildings.svelte.
	 */
	import { T, useTask } from '@threlte/core';
	import { useTexture } from '@threlte/extras';
	import {
		Vector3,
		Matrix4,
		Group,
		Sprite,
		SpriteMaterial,
		Color,
		type Texture,
		type Group as ThreeGroup,
	} from 'three';
	import { LOCATION_MAP } from '$content/locations';
	import { CLOUD_DECK_M, geoToCartesian } from './state.svelte';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	let {
		density,
		nightFactor = 0,
		ambientColor,
		ambientIntensity = 1,
		sunDirection,
	}: {
		density: number;
		nightFactor?: number;
		/** Environment ambient colour — multiplies per-sprite base brightness each frame. */
		ambientColor?: Color;
		ambientIntensity?: number;
		/** Live sun direction (unit vec) from SkyState — enables real per-frame side-lighting on clouds. */
		sunDirection?: [number, number, number];
	} = $props();

	const model = useAeroWindow();
	const weather = $derived(model.weather);
	const location = $derived(model.location);
	const driftSpeed = $derived(model.config.atmosphere.clouds.speed);
	const opacityScale = $derived(model.config.atmosphere.clouds.opacityScale);

	// Texture pool — same three PNGs as production ArtsyClouds.
	const TEXTURE_URLS = ['/cloud.webp', '/cloud-dark.webp', '/cloud-smoke.webp'];
	const POOLS: Record<string, number[]> = {
		clear:    [0],
		cloudy:   [0],
		rain:     [0, 1],
		overcast: [1, 2],
		storm:    [1, 2],
	};

	const texturesPromise = useTexture(TEXTURE_URLS);

	let anchorMatrix = $state.raw<Matrix4 | null>(null);
	let anchorGroup: ThreeGroup | undefined = $state.raw();

	// driftGroup is a long-lived Three.js Group we populate imperatively.
	// Created once; cleared + rebuilt when location/weather/density change.
	const driftGroup = new Group();

	// Per-sprite arrays — all index-aligned with driftGroup.children.
	const rotSpeeds: number[] = [];
	const baseGreys: number[] = [];     // intrinsic brightness 0-1 (pre-modulation)
	const baseOpacities: number[] = []; // intrinsic opacity 0-1 (pre-opacityScale)
	// Materials we own and must dispose on rebuild/unmount.
	const ownedMaterials: SpriteMaterial[] = [];

	function clearClusters(): void {
		while (driftGroup.children.length > 0) {
			driftGroup.remove(driftGroup.children[0]);
		}
		for (const m of ownedMaterials) m.dispose();
		ownedMaterials.length = 0;
		rotSpeeds.length = 0;
		baseGreys.length = 0;
		baseOpacities.length = 0;
	}

	function buildClusters(textures: Texture[], weatherKey: string, dens: number): void {
		clearClusters();
		const pool = POOLS[weatherKey] ?? POOLS.clear;
		// More clouds for a richer sky. Scales ~35 → 90 with density.
		// Strong lateral horizon bias + vertical spread so the deck reads
		// as distant weather systems, not puffs directly under the plane.
		const clusterCount = Math.round(35 + Math.min(1, dens) * 55);

		for (let c = 0; c < clusterCount; c++) {
			// Cluster anchor — wider spread across the horizon.
			// Large radius + sqrt bias for strong lateral distribution along
			// the distant horizon band rather than uniform disk under aircraft.
			const theta = Math.random() * Math.PI * 2;
			// 42 km min out (avoids under-wing) → ~307 km max. Strong horizon push.
			const r = 42_000 + Math.sqrt(Math.random()) * 265_000;
			const cx = Math.cos(theta) * r;
			const cz = -Math.sin(theta) * r; // -north in our basis convention

			// Wider vertical band, slight upward bias — clouds sit on the
			// true horizon from cruise altitude instead of filling the nadir.
			const ch = (Math.random() - 0.18) * 4600;

			// Larger clouds — 8–24 km base scale. Feels more like real weather
			// systems when viewed from 30–35k ft.
			const baseScale = 8000 + Math.random() * 16000;
			const isLonely = Math.random() < 0.06; // rare singleton clouds
			const spriteCount = isLonely ? 1 : 7 + Math.floor(Math.random() * 8); // 7-14 (denser clusters)

			for (let i = 0; i < spriteCount; i++) {
				// Within-cluster offset — HORIZONTAL stretch. Real cumulus
				// reads wide-and-flat from cruise altitude, not tall-and-narrow.
				// 1.4× spread on x/z, only 0.18× on y.
				const ox = cx + (Math.random() - 0.5) * baseScale * 1.40;
				const oz = cz + (Math.random() - 0.5) * baseScale * 1.40;
				const oy = ch + (Math.random() - 0.5) * baseScale * 0.18;

				const idx = pool[Math.floor(Math.random() * pool.length)];
				// Vary sprite scale within cluster — bottom/edge sprites slightly
				// smaller, anchor sprite (i=0) gets a "core" pass at full scale.
				// Sprites stretched 1.3:1 horizontally to reinforce flat-cloud feel.
				const sprScale = baseScale * (i === 0 ? 1.0 : 0.55 + Math.random() * 0.65);
				const sprX = sprScale * 1.30;
				const sprY = sprScale;

				// Bottom sprites darker (cloud underside). Y-range is much
				// tighter now (×0.18) so we rescale the yNorm window to match.
				const yNorm = (oy - ch + baseScale * 0.09) / (baseScale * 0.18);
				// Intrinsic base brightness (albedo-like). Live sun dot-product,
				// ambient from scene lights, and nightFactor are applied in the
				// cheap per-frame modulator below — never baked at creation.
				const brightness = 0.68 + Math.max(0, Math.min(1, yNorm)) * 0.32;

				const baseOpacity = 0.55 + Math.random() * 0.4;

				// Material gets intrinsic brightness + opacity only. Night tint,
				// ambient mix, and opacityScale are modulated each frame in the
				// effect below — changing any of them never triggers rebuild.
				const mat = new SpriteMaterial({
					map: textures[idx],
					transparent: true,
					opacity: baseOpacity,
					depthWrite: false,
					color: new Color(brightness, brightness, brightness),
					rotation: Math.random() * Math.PI * 2,
				});
				mat.userData.baseBrightness = brightness;
				mat.userData.baseOpacity = baseOpacity;
				ownedMaterials.push(mat);

				const sprite = new Sprite(mat);
				sprite.position.set(ox, oy, oz);
				sprite.scale.set(sprX, sprY, 1);
				driftGroup.add(sprite);

				rotSpeeds.push((Math.random() - 0.5) * 0.08);
			}
		}
	}

	// Anchor matrix — re-derived when location changes.
	$effect(() => {
		const loc = LOCATION_MAP.get(location);
		if (!loc) { anchorMatrix = null; return; }
		const [x, y, z] = geoToCartesian(loc.lat, loc.lon, CLOUD_DECK_M);
		const up    = new Vector3(x, y, z).normalize();
		const east  = new Vector3().crossVectors(new Vector3(0, 1, 0), up).normalize();
		const north = new Vector3().crossVectors(up, east).normalize();
		const matrix = new Matrix4().makeBasis(east, up, north.clone().negate());
		matrix.setPosition(x, y, z);
		anchorMatrix = matrix;
	});

	// Apply anchor matrix reactively (matrixAutoUpdate off — drift on the
	// inner group composes via its own matrix, not on the anchor).
	$effect(() => {
		if (!anchorGroup || !anchorMatrix) return;
		anchorGroup.matrixAutoUpdate = false;
		anchorGroup.matrix.copy(anchorMatrix);
	});

	// Rebuild full clusters only on weather, density, or location changes.
	// NightFactor is handled cheaply below by updating existing materials.
	$effect(() => {
		const w = weather;
		const d = density;
		// Touch anchorMatrix so we rebuild on location change.
		void anchorMatrix;
		let cancelled = false;
		texturesPromise.then((textures) => {
			if (cancelled) return;
			buildClusters(textures, w, d);
		});
		return () => { cancelled = true; };
	});

	// Cheap runtime modulation — no full rebuild. Modulates per-sprite
	// color AND opacity from the intrinsic base values stored in userData.
	// Live sun direction (passed from ThreeViewer/SkyState) gives real
	// directional side-lighting that changes with timeOfDay + flight.
	// NightFactor cool/dark + scene ambient tint applied every frame.
	$effect(() => {
		const nf = nightFactor;
		const ambR = ambientColor?.r ?? 1;
		const ambG = ambientColor?.g ?? 1;
		const ambB = ambientColor?.b ?? 1;
		const ambI = ambientIntensity;
		const opaScale = opacityScale;

		// Stronger night response — deeper cool darkening at night.
		const nightDark = 1 - nf * 0.73;
		const coolG = 1 - nf * 0.16;
		const coolB = 1 - nf * 0.11;

		// Live sun dot for 3D side-lighting (same cheap cluster normal approx).
		// Strong when sun low on horizon; zero at night via (1-nf) gate.
		const sd = sunDirection;
		let liveSunBoost = 0;
		if (sd && sd.length === 3) {
			const clusterN = [0.0, 0.92, 0.08];
			const sunDot = Math.max(0, sd[0]*clusterN[0] + sd[1]*clusterN[1] + sd[2]*clusterN[2]);
			liveSunBoost = sunDot * (1 - nf) * 0.52;
		}

		for (const mat of ownedMaterials) {
			const baseB = (mat.userData.baseBrightness ?? 1) as number;
			const baseO = (mat.userData.baseOpacity ?? 1) as number;
			// Sun boost adds directional "lit" contrast before night/ambient tint.
			const litB = baseB * (1 + liveSunBoost * 0.85);
			mat.color.setRGB(
				litB * nightDark         * ambR * ambI,
				litB * nightDark * coolG * ambG * ambI,
				litB * nightDark * coolB * ambB * ambI,
			);
			mat.opacity = baseO * opaScale;
		}
	});

	// Per-frame: rotate each sprite around its screen axis + drift the
	// whole group slowly around the city's vertical (wind).
	useTask((dt) => {
		const children = driftGroup.children;
		for (let i = 0; i < children.length; i++) {
			const s = children[i] as Sprite;
			s.material.rotation += rotSpeeds[i] * dt;
		}
		driftGroup.rotation.y += dt * driftSpeed * 0.004;
	});

	// Component-unmount disposal.
	$effect(() => () => clearClusters());
</script>

{#if anchorMatrix}
	<T.Group bind:ref={anchorGroup}>
		<T is={driftGroup} />
	</T.Group>
{/if}
