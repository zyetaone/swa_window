<script lang="ts">
	/**
	 * atmospheric-haze — softens the visible LOD boundary by adding a screen-
	 * vertical sky-colored gradient layered above the Cesium globe.
	 *
	 * Why CSS not Cesium fog:
	 *   Cesium fog is depth-aware (per-pixel terrain distance) and we already
	 *   tune it via sceneFog. But it's uniform across the screen at any depth.
	 *   Visible LOD seams sit at midground, where terrain detail steps. A
	 *   screen-vertical gradient adds atmospheric haze where it visually matters
	 *   (top half → distant horizon → midground LOD step zone) without dimming
	 *   the foreground city.
	 *
	 * Color matches the current sky state so the gradient blends seamlessly into
	 * the horizon — looks like real airborne haze, not a tinted overlay.
	 */
	import type { EffectProps } from '$lib/scene/types';
	import { clamp } from '$lib/utils';

	let { model }: EffectProps = $props();

	const hazeColor = $derived.by(() => {
		switch (model.skyState) {
			case 'night': return 'rgba(20, 28, 50, 0.55)';    // deep navy
			case 'dawn':  return 'rgba(220, 150, 110, 0.45)'; // warm amber
			case 'dusk':  return 'rgba(200, 110, 90, 0.5)';   // warm coral
			default:      return 'rgba(170, 195, 220, 0.45)'; // cool atmospheric blue
		}
	});

	// Composite haze: global scalar (model.haze, 0–0.15) × per-location multiplier × altitude depth.
	// Normalized so max global haze (0.15) × max location multiplier (1.3) × max altitude (1.1) = 1.0.
	const MAX_HAZE = 0.15 * 1.3 * 1.1; // ≈ 0.215
	const altitudeScale = $derived(0.8 + Math.min(model.flight.altitude / 50000, 1) * 0.3);
	const intensity = $derived(
		clamp(model.haze * (model.currentLocation.scene.haze?.intensity ?? 1.0) * altitudeScale / MAX_HAZE, 0, 1),
	);
</script>

<div
	class="haze"
	style:background={`linear-gradient(to bottom, ${hazeColor} 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0) 100%)`}
	style:opacity={intensity}
></div>

<style>
	.haze {
		position: absolute;
		inset: 0;
		pointer-events: none;
		mix-blend-mode: screen;
		transition: background 1.5s ease, opacity 1.5s ease;
	}
</style>
