<script lang="ts">
	/**
	 * SparkleField — cabin-air dust motes that track the camera.
	 * Part of the hybrid artistic layer set (see ThreeOverlay.svelte).
	 *
	 * Threlte's <Sparkles> lives at scene origin by default; when the
	 * camera flies away from origin (WGS84 scale = millions of metres)
	 * the sparkles fall out of view. Wrapping in a T.Group whose position
	 * we update each frame to follow the camera keeps them perpetually
	 * "in cabin air" regardless of flight position.
	 *
	 * Drift speed + noise come from Sparkles' own animation — the wrapper
	 * just translates. The group has no rotation tracking so the sparkles
	 * don't shear when the camera banks.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import { Sparkles } from '@threlte/extras';
	import type { Group as ThreeGroup } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { createSeededRng, daySeed } from '$lib/world/prng';

	const model = useAeroWindow();
	const ctx = useThrelte();
	const nightFactor = $derived(model.nightFactor);

	// Cabin-air light motes — a few soft drifting points that catch the
	// window light and give the night cabin air depth. Count kept low (Pi
	// GPU budget + "not a snowstorm"); per-particle size/opacity variance
	// makes them read as real floating dust rather than a uniform grid.
	//
	// Per-particle size + opacity are SEEDED (daySeed) so the build-once
	// values are deterministic — Sparkles otherwise fills these with
	// Math.random(). The motes are near-field cabin dust (not the distant
	// panorama), so this is belt-and-braces for invariant #4 rather than a
	// hard seam requirement, but it keeps the whole layer free of live
	// build-once Math.random().
	const MOTE_COUNT = 60;
	const moteSizes = (() => {
		const rng = createSeededRng(daySeed() ^ 0x5a17);
		// 1.1 → 2.6 px equivalent: most small, a few larger "catch-light" motes.
		return Float32Array.from({ length: MOTE_COUNT }, () => 1.1 + Math.pow(rng(), 2) * 1.5);
	})();
	const moteOpacities = (() => {
		const rng = createSeededRng(daySeed() ^ 0x2b9d);
		// Per-particle base opacity 0.10 → 0.34 so depth reads (some faint,
		// some present) instead of a flat sheet of identical points.
		return Float32Array.from({ length: MOTE_COUNT }, () => 0.10 + rng() * 0.24);
	})();

	let group = $state.raw<ThreeGroup | undefined>();

	// The "alive" feel comes from Sparkles' own per-particle speed + noise
	// drift (each mote wanders on its own seeded path) combined with the
	// per-particle size/opacity variance above — no global rebuild-thrashing
	// breathe needed. The group just tracks the camera so the motes stay in
	// cabin air as the plane flies.
	useTask(() => {
		if (!group) return;
		const camPos = ctx.camera.current.position;
		group.position.set(camPos.x, camPos.y, camPos.z);
	});
</script>

{#if nightFactor > 0.25}
	<T.Group bind:ref={group}>
		<Sparkles
			count={MOTE_COUNT}
			size={moteSizes}
			scale={[5200, 1700, 5200]}
			speed={0.32}
			opacity={moteOpacities}
			color="#fff4dc"
			noise={0.9}
		/>
	</T.Group>
{/if}
