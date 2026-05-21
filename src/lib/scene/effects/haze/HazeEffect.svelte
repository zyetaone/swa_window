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

	// Phase 10 (user direction "css layer over the maps"): warm-glow bottom
	// band overlay simulating the city-light dome rising from below.
	//
	// DERIVED from BOTH VIIRS density AND map content via nightLightScale —
	// not a constant tint. nightLightScale is the same factor compose.ts uses
	// to modulate VIIRS layer alpha (high over cities, near-zero over oceans/
	// mountains), giving environment-aware falloff: warm dome glows strongly
	// over Hyderabad / Mumbai / Tokyo, fades to nothing over Pacific Ocean.
	//
	// Multiplied by nightFactor so it's also gated by time-of-day.
	const warmGlowOpacity = $derived(
		clamp(model.nightFactor * model.nightLightScale * 0.55, 0, 0.55),
	);
</script>

<div
	class="haze"
	style:background={`linear-gradient(to bottom, ${hazeColor} 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0) 100%)`}
	style:opacity={intensity}
></div>

<div
	class="warm-glow"
	style:opacity={warmGlowOpacity}
></div>

<style>
	.haze {
		position: absolute;
		inset: 0;
		pointer-events: none;
		mix-blend-mode: screen;
		transition: background 1.5s ease, opacity 1.5s ease;
	}
	.warm-glow {
		position: absolute;
		inset: 0;
		pointer-events: none;
		/* SCREEN (additive) blend — reads as light EMANATING from the map
		   below, not as a tint applied to the window. The gradient anchors
		   below the frame so the glow appears to rise FROM the ground up
		   toward the camera. This is the atmospheric pollution-dome look
		   visible in real night-aerial photos over major cities. */
		mix-blend-mode: screen;
		background: radial-gradient(
			ellipse 75% 45% at 50% 100%,
			rgba(255, 140, 50, 0.55) 0%,
			rgba(220, 90, 30, 0.30) 35%,
			rgba(0, 0, 0, 0) 75%
		);
		transition: opacity 1.5s ease;
	}
</style>
