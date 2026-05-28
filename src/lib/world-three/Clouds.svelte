<script lang="ts">
	/**
	 * Clouds — PNG-sprite CLUSTER composition at the WGS84 cloud deck.
	 *
	 * Mirrors the production ArtsyClouds technique
	 * (src/lib/scene/effects/clouds/ArtsyClouds.svelte): each cloud is a
	 * CLUSTER of 5-12 sprites stacked with random offset, scale, rotation,
	 * brightness, and opacity. The cluster reads as one volumetric cloud;
	 * collections of clusters at varied altitudes form the cloud deck.
	 *
	 * TWO BANDS:
	 *   - DISTANT: 35-90 large clusters at 42-307 km radius (horizon weather
	 *              systems). 8-24 km baseScale. 7-15 sprites per cluster.
	 *   - CLOSE:   12-28 small clusters at 2-32 km radius (clouds passing the
	 *              passenger window as we cruise). 1.5-4.5 km baseScale.
	 *              3-8 sprites per cluster. This is what sells the "we're
	 *              flying THROUGH the deck" feel — without it the deck reads
	 *              as a static landscape.
	 *
	 * Built imperatively (THREE.Sprite + per-sprite SpriteMaterial) so we
	 * can animate per-sprite material.rotation in useTask without a 100-
	 * way reactive prop binding. The whole cluster set sits inside a
	 * driftGroup that slowly rotates around the city's vertical axis for
	 * wind drift. The driftGroup itself sits inside an anchorGroup whose
	 * matrix is an ENU basis at the city's lat/lon — same convention as
	 * NeonLineLayer's footprint anchor.
	 */
	import { T, useTask } from '@threlte/core';
	import { useTexture } from '@threlte/extras';
	import {
		Group,
		Sprite,
		SpriteMaterial,
		Color,
		type Texture,
	} from 'three';
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

	// driftGroup is a long-lived Three.js Group we populate imperatively.
	// Created once; cleared + rebuilt when density/weather change.
	const driftGroup = new Group();

	// Per-sprite arrays — all index-aligned with driftGroup.children.
	const rotSpeeds: number[] = [];
	// Materials we own and must dispose on rebuild/unmount.
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

		// --- DISTANT BAND --- horizon weather systems
		for (let c = 0; c < distantCount; c++) {
			emitCluster(textures, pool, 42_000, 265_000, 8000, 16000, 7, 8, 0.06);
		}

		// --- CLOSE BAND --- nearby clouds the camera passes through
		// Slightly higher lonely-chance because real near-clouds are often
		// discrete puffs, not big systems.
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
		// Cluster anchor — sqrt(rand) gives uniform area density.
		const theta = Math.random() * Math.PI * 2;
		const r = radiusMin + Math.sqrt(Math.random()) * radiusSpan;
		const cx = Math.cos(theta) * r;
		const cz = -Math.sin(theta) * r;

		// Vertical band, slight upward bias — clouds sit at / above the
		// cloud deck. Close clouds get a tighter vertical spread so they
		// land at camera altitude as it cruises through the deck.
		const ch = (Math.random() - 0.18) * 4600;

		const baseScale = baseScaleMin + Math.random() * baseScaleSpan;
		const isLonely = Math.random() < lonelyChance;
		const spriteCount = isLonely ? 1 : spriteMin + Math.floor(Math.random() * spriteSpan);

		for (let i = 0; i < spriteCount; i++) {
			// Within-cluster offset — HORIZONTAL stretch. Real cumulus
			// reads wide-and-flat from cruise altitude.
			const ox = cx + (Math.random() - 0.5) * baseScale * 1.40;
			const oz = cz + (Math.random() - 0.5) * baseScale * 1.40;
			const oy = ch + (Math.random() - 0.5) * baseScale * 0.18;

			const idx = pool[Math.floor(Math.random() * pool.length)];
			// Vary sprite scale within cluster — anchor (i=0) at full,
			// rest 0.55-1.20×. Sprites stretched 1.3:1 horizontally.
			const sprScale = baseScale * (i === 0 ? 1.0 : 0.55 + Math.random() * 0.65);
			const sprX = sprScale * 1.30;
			const sprY = sprScale;

			// Bottom-of-cluster darker (cloud underside).
			const yNorm = (oy - ch + baseScale * 0.09) / (baseScale * 0.18);
			const brightness = 0.68 + Math.max(0, Math.min(1, yNorm)) * 0.32;
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

	// Rebuild clusters on density or weather change.
	// (NightFactor + sunDirection are handled cheaply in the per-frame modulator below.
	// The hybrid path supplies camera via CameraMirror; no self-anchoring needed.)
	$effect(() => {
		const w = weather;
		const d = density;
		let cancelled = false;
		texturesPromise.then((textures) => {
			if (cancelled) return;
			buildClusters(textures, w, d);
		});
		return () => { cancelled = true; };
	});

	// Cheap runtime modulation — no full rebuild. Modulates per-sprite
	// color AND opacity from the intrinsic base values stored in userData.
	$effect(() => {
		const nf = nightFactor;
		const ambR = ambientColor?.r ?? 1;
		const ambG = ambientColor?.g ?? 1;
		const ambB = ambientColor?.b ?? 1;
		const ambI = ambientIntensity;
		const opaScale = opacityScale;

		const nightDark = 1 - nf * 0.73;
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

	$effect(() => () => clearClusters());
</script>

<T is={driftGroup} />
