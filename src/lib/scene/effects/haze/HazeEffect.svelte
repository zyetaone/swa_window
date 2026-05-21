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
	import { SKY_PALETTE } from '$content/palettes';
	import { clamp } from '$lib/utils';

	let { model }: EffectProps = $props();

	// Per-skyState haze color + alpha — authored in $content/palettes/sky.ts.
	// Alpha tuning note (kept here because it's about BLEND MODE not palette):
	// screen blend compounds brightness over bright sky. Daytime Cesium sky
	// near (120,160,200) + pale blue at 0.45 → near-white. 0.18 alpha on day
	// restores subtle haze without washout. Night stays at 0.55 because
	// navy + screen on black-starry = tint-only.
	const hazeColor = $derived(SKY_PALETTE[model.skyState].haze);

	const MAX_HAZE = 0.15 * 1.3 * 1.1;
	const altitudeScale = $derived(0.8 + Math.min(model.flight.altitude / 50000, 1) * 0.3);
	const intensity = $derived(
		clamp(
			model.config.atmosphere.haze.amount
			* (model.currentLocation.scene.haze?.intensity ?? 1.0)
			* altitudeScale / MAX_HAZE,
			0,
			1,
		),
	);

	// Phase 10 — warm-glow moved INTO Pane.svelte's .render-layer (the Cesium
	// canvas's own DOM container) so it's bound to the MAP IMAGE LAYER, not
	// the SCREEN/WINDOW layer. See Pane.svelte for the actual element.
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
