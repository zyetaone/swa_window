<script lang="ts">
	/**
	 * Clouds — PNG-sprite CLUSTER composition at the WGS84 cloud deck.
	 *
	 * TWO BANDS:
	 *   - DISTANT: 35-90 large clusters at 42-307 km radius. 8-24 km
	 *              baseScale. 7-15 sprites/cluster. Horizon weather systems.
	 *   - CLOSE:   12-28 small clusters at 2-32 km radius. 1.5-4.5 km
	 *              baseScale. 3-8 sprites/cluster. Near clouds passing the
	 *              passenger window — sells the "flying THROUGH the deck" feel.
	 *
	 * Built imperatively (THREE.Sprite + per-sprite SpriteMaterial) so we
	 * can animate per-sprite material.rotation in useTask without a 100-
	 * way reactive prop binding. The driftGroup lives directly in the
	 * hybrid Canvas (camera provided by CameraMirror over Cesium).
	 * Artistic cloud deck only — no self-anchoring.
	 */
	import { T, useTask } from '@threlte/core';
	import { useTexture } from '@threlte/extras';
	import {
		Matrix4,
		Group,
		Sprite,
		SpriteMaterial,
		Color,
		type Texture,
		type Group as ThreeGroup,
	} from 'three';
	import { LOCATION_MAP } from '$content/locations';
	import { CLOUD_DECK_M } from './state.svelte';
	import { enuAnchorMatrix } from './enu';
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
		ambientColor?: Color;
		ambientIntensity?: number;
		sunDirection?: [number, number, number];
	} = $props();

	const model = useAeroWindow();
	const weather = $derived(model.weather);
	const location = $derived(model.location);
	const driftSpeed = $derived(model.config.atmosphere.clouds.speed);
	const opacityScale = $derived(model.config.atmosphere.clouds.opacityScale);

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

	const driftGroup = new Group();
	const rotSpeeds: number[] = [];
	const ownedMaterials: SpriteMaterial[] = [];

	function clearClusters(): void {
		while (driftGroup.children.length > 0) {
			driftGroup.remove(driftGroup.children[0]);
		}
		for (const m of ownedMaterials) m.dispose();
		ownedMaterials.length = 0;
		rotSpeeds.length = 0;
	}

	function buildClusters(textures: Texture[], weatherKey: string, dens: number): void {
		clearClusters();
		const pool = POOLS[weatherKey] ?? POOLS.clear;

		const distantCount = Math.round(35 + Math.min(1, dens) * 55);
		const closeCount   = Math.round(12 + Math.min(1, dens) * 16);

		for (let c = 0; c < distantCount; c++) {
			emitCluster(textures, pool, 42_000, 265_000, 8000, 16000, 7, 8, 0.06);
		}
		for (let c = 0; c < closeCount; c++) {
			emitCluster(textures, pool, 2_000, 30_000, 1500, 3000, 3, 5, 0.18);
		}
	}

	function emitCluster(
		textures: Texture[],
		pool: number[],
		radiusMin: number, radiusSpan: number,
		baseScaleMin: number, baseScaleSpan: number,
		spriteMin: number, spriteSpan: number,
		lonelyChance: number,
	): void {
		const theta = Math.random() * Math.PI * 2;
		const r = radiusMin + Math.sqrt(Math.random()) * radiusSpan;
		const cx = Math.cos(theta) * r;
		const cz = -Math.sin(theta) * r;
		const ch = (Math.random() - 0.18) * 4600;

		const baseScale = baseScaleMin + Math.random() * baseScaleSpan;
		const isLonely = Math.random() < lonelyChance;
		const spriteCount = isLonely ? 1 : spriteMin + Math.floor(Math.random() * spriteSpan);

		for (let i = 0; i < spriteCount; i++) {
			const ox = cx + (Math.random() - 0.5) * baseScale * 1.40;
			const oz = cz + (Math.random() - 0.5) * baseScale * 1.40;
			const oy = ch + (Math.random() - 0.5) * baseScale * 0.18;

			const idx = pool[Math.floor(Math.random() * pool.length)];
			const sprScale = baseScale * (i === 0 ? 1.0 : 0.55 + Math.random() * 0.65);
			const sprX = sprScale * 1.30;
			const sprY = sprScale;

			const yNorm = (oy - ch + baseScale * 0.09) / (baseScale * 0.18);
			// Base brightness lowered 0.68→0.55: prior floor kept clouds glowing
			// at night even with the modulator's nightDark factor.
			const brightness = 0.55 + Math.max(0, Math.min(1, yNorm)) * 0.32;
			const baseOpacity = 0.55 + Math.random() * 0.4;

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

	// ENU basis at the city's lat/lon, at cloud-deck altitude.
	$effect(() => {
		const loc = LOCATION_MAP.get(location);
		if (!loc) { anchorMatrix = null; return; }
		anchorMatrix = enuAnchorMatrix(loc.lat, loc.lon, CLOUD_DECK_M);
	});

	$effect(() => {
		if (!anchorGroup || !anchorMatrix) return;
		anchorGroup.matrixAutoUpdate = false;
		anchorGroup.matrix.copy(anchorMatrix);
	});

	$effect(() => {
		const w = weather;
		const d = density;
		void anchorMatrix;
		let cancelled = false;
		texturesPromise.then((textures) => {
			if (cancelled) return;
			buildClusters(textures, w, d);
		});
		return () => { cancelled = true; };
	});

	// Cheap runtime modulation — no full rebuild.
	$effect(() => {
		const nf = nightFactor;
		const ambR = ambientColor?.r ?? 1;
		const ambG = ambientColor?.g ?? 1;
		const ambB = ambientColor?.b ?? 1;
		const ambI = ambientIntensity;
		const opaScale = opacityScale;

		// 0.73→0.88: clouds drop to 12% at full night (was 27%). Combined
		// with the lower base brightness (0.55 vs 0.68) and the new ambient
		// floor (0.12 vs 0.45) the night deck reads as silhouette, not glow.
		const nightDark = 1 - nf * 0.88;
		const coolG = 1 - nf * 0.16;
		const coolB = 1 - nf * 0.11;

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
			const litB = baseB * (1 + liveSunBoost * 0.85);
			mat.color.setRGB(
				litB * nightDark         * ambR * ambI,
				litB * nightDark * coolG * ambG * ambI,
				litB * nightDark * coolB * ambB * ambI,
			);
			mat.opacity = baseO * opaScale;
		}
	});

	// Per-frame: rotate each sprite + wind-drift around city vertical.
	// Reading anchorMatrix here makes it a live tick-path dependency so
	// the autofixer cannot dead-code-eliminate the anchor scaffolding.
	useTask((dt) => {
		void anchorMatrix;
		const children = driftGroup.children;
		for (let i = 0; i < children.length; i++) {
			const s = children[i] as Sprite;
			s.material.rotation += rotSpeeds[i] * dt;
		}
		driftGroup.rotation.y += dt * driftSpeed * 0.004;
	});

	$effect(() => () => clearClusters());
</script>

{#if anchorMatrix}
	<T.Group bind:ref={anchorGroup}>
		<T is={driftGroup} />
	</T.Group>
{/if}
