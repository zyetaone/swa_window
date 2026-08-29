<script lang="ts">
	/**
	 * Sky — Unified Circadian Atmosphere, Sky Dome, Solar Radiance & Night Starfield.
	 *
	 * Unifies:
	 * 1. MapLibre 3D Sky Dome (<SkyDome>): Rayleigh scattering, horizon mist band,
	 *    and terrain distance fog.
	 * 2. Circadian Celestial Layer: Solar flare radiance at dusk/dawn, and deep space
	 *    starfield with Milky Way at night, fully synchronized with `display.sun`,
	 *    `display.night`, and local destination solar time.
	 */
	import { Sky as SkyDome } from 'svelte-maplibre-gl';
	import { useDisplay } from '../display.svelte.js';
	import { duskHorizonMix, duskVaultMix } from './sun.js';
	import { cssRgb, lerpRgb } from './atmosphere.js';

	const display = useDisplay();

	const night = $derived(display.night);
	const sunElev = $derived(display.sun.elevationDeg);
	const sunAzimuth = $derived(display.sun.azimuthDeg);
	const bank = $derived(display.view.bankDeg);

	/**
	 * How far the window is looking DOWN, degrees, as actually rendered.
	 *
	 * `config.pitchDeg` is the static setting and was what this used. The
	 * camera does not fly at that number: `viewOptions` folds the bank into it
	 * at BANK_VIEW_GAIN and turbulence adds a jitter on top, so the setting is
	 * only the pitch when the wings are level and the air is still.
	 * `view.cameraPitchDeg` is the value the frame was drawn with.
	 */
	const depressionDeg = $derived(Math.max(0, 90 - display.view.cameraPitchDeg));

	// ── 1. Circadian & Solar-Graded Sky Vault Colors ──────────────────────────
	const skyTop = $derived.by(() => {
		const base = display.atmosphere.skyTop;

		// Fades out by 14 deg of sun elevation. `Math.abs` so it applies equally
		// either side of the horizon — the vault dims at dawn as it does at dusk.
		const dusk = duskVaultMix(sunElev);

		const duskSky: readonly [number, number, number] = [0.22, 0.12, 0.32];
		const nightSky: readonly [number, number, number] = [0.01, 0.02, 0.06];

		const duskBlended = lerpRgb(base, duskSky, dusk * 0.55);
		return lerpRgb(duskBlended, nightSky, night);
	});

	const skyHorizon = $derived.by(() => {
		const base = display.atmosphere.skyHorizon;

		/**
		 * Sunset orange, confined to when the sun is actually near the horizon.
		 *
		 * This was `(15 - elev) / 15`, which is not symmetric about the horizon
		 * and does not reach zero until the sun is 15 deg up — well into
		 * mid-morning. At 10 deg it still mixed 33% of a deep sunset orange into
		 * a blue sky, and blending #d96b2e into #99b8db gives #ae9ea2: a muddy
		 * grey-pink, which is what a clear morning was rendering as.
		 *
		 * Now gone by 8 deg and eased, so the colour belongs to the twenty
		 * minutes either side of sunrise and sunset that actually own it.
		 */
		const dusk = duskHorizonMix(sunElev);

		const duskHorizon: readonly [number, number, number] = [0.85, 0.42, 0.18];
		const nightHorizon: readonly [number, number, number] = [0.03, 0.06, 0.14];

		const duskBlended = lerpRgb(base, duskHorizon, dusk * (1 - night));
		return lerpRgb(duskBlended, nightHorizon, night);
	});

	const fogColor = $derived.by(() => {
		const base = display.atmosphere.skyHorizon;
		const dayFog: readonly [number, number, number] = [0.76, 0.86, 0.96];
		const nightFog: readonly [number, number, number] = [0.04, 0.07, 0.15];

		const blendedDay = lerpRgb(base, dayFog, 0.45);
		return lerpRgb(blendedDay, nightFog, night);
	});

	/**
	 * Fog thickness, mapped from the band's own `fogDensity`.
	 *
	 * This was `clamp(fogDensity * 2400, 0.65, 0.95)`, and the floor was doing
	 * almost all the work: four of the five bands multiplied out BELOW 0.65
	 * (ground 0.24, haze 0.60, cirrus 0.48, stratosphere 0.19), so they were all
	 * forced to the same 0.65 and only midDeck ever exceeded it. The window sat
	 * in near-constant haze whatever the altitude, and the band model — the
	 * thing that is supposed to make climbing feel like climbing — could not be
	 * seen.
	 *
	 * Now the band's density is mapped across the full range with no floor, so
	 * ground reads 0.22, midDeck still peaks at 0.86, and the stratosphere
	 * clears to 0.18. midDeck stays the thickest band on purpose: that is where
	 * the cloud deck lives.
	 */
	const FOG_MIN_DENSITY = 0.8e-4;
	const FOG_MAX_DENSITY = 4.0e-4;
	const groundBlend = $derived.by(() => {
		const t =
			(display.atmosphere.fogDensity - FOG_MIN_DENSITY) / (FOG_MAX_DENSITY - FOG_MIN_DENSITY);
		return 0.18 + 0.68 * Math.max(0, Math.min(1, t));
	});

	// ── 2. Celestial Starfield & Solar Radiance ──────────────────────────────
	interface Star {
		x: number;
		y: number;
		size: number;
		opacity: number;
		twinkleDuration: number;
		twinkleDelay: number;
	}

	/**
	 * A fixed sky, drawn once. Deterministic on purpose -- three panes must
	 * agree -- but it has to be deterministic AND look random, and it was only
	 * the first.
	 *
	 * Each star re-seeded the generator from its own index: `(i * 9301 + 49297)
	 * % 233280`. 9301 is coprime with 233280, so that is not a sample, it is an
	 * arithmetic progression: across the 140 stars, 114 of the 139 gaps in x
	 * were the same 0.324%, the rest being where the sequence wraps. The other
	 * two values were then derived from that same seed, so y, size and opacity
	 * were all functions of x. An evenly-spaced comb of stars whose brightness
	 * varies with position -- the one thing a night sky must never look like.
	 *
	 * Iterating the state is the whole fix. Same seed, same sky, every pane.
	 */
	const STARS: Star[] = (() => {
		let seed = 20260828;
		const next = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		return Array.from({ length: 140 }, () => {
			const x = next();
			const y = next();
			const bright = next();
			const twinkle = next();
			return {
				x: x * 100,
				y: y * 75,
				size: bright > 0.85 ? 2.2 : bright > 0.5 ? 1.5 : 0.9,
				opacity: 0.35 + bright * 0.65,
				twinkleDuration: 2.0 + twinkle * 3.0,
				twinkleDelay: next() * 4.0
			};
		});
	})();

	const duskFactor = $derived(Math.max(0, Math.min(1, (12 - Math.abs(sunElev)) / 12)));
	const sunHeadingDelta = $derived(
		((sunAzimuth - display.view.cameraBearingDeg + 540) % 360) - 180
	);
	const sunScreenX = $derived(50 + (sunHeadingDelta / 180) * 50);

	/**
	 * Where the horizon sits down the glass, as a percentage from the top.
	 *
	 * The starfield is an absolutely-positioned overlay ABOVE the map canvas,
	 * so without this it paints stars over the terrain, the sea and the cloud
	 * deck -- night sky in the foreground. Reordering cannot fix that: put the
	 * overlay behind an opaque map canvas and the stars vanish entirely. The
	 * fix is to mask it to the region above the horizon.
	 *
	 * Linear in pitch rather than a projection: the window looks down between
	 * roughly -5 and -35 degrees, and across that band an analytic pinhole
	 * horizon and a straight line differ by less than the softness of the
	 * fade. `HORIZON_AT_LEVEL` and `PER_DEGREE` are tuned against real frames,
	 * not derived -- an earlier pinhole model put the horizon above the top of
	 * frame, which the screenshots plainly contradicted.
	 *
	 * Measured off clouds-off frames at pitch -5/-20/-35: 38%, 56%, 52%. The
	 * scatter was read as "bank, not error" and answered by widening the fade
	 * band to 12%, which held only by accident: BANK_VIEW_GAIN (0.85) against
	 * the then-current maxBankDeg of 14 moves the horizon +/-10.7% of screen
	 * height, just inside 12%. Raising maxBankDeg to 18 moved it to +/-13.8%
	 * and stars began drawing over the ground on every turn.
	 *
	 * The band was never the fix. `view.cameraPitchDeg` already contains the
	 * bank, so the mask now tracks the horizon instead of trying to out-run it,
	 * and the fade band is back to being a soft edge rather than a tolerance.
	 */
	const HORIZON_AT_LEVEL = 36;
	const PER_DEGREE = 0.9;
	const horizonPct = $derived(
		Math.max(0, Math.min(100, HORIZON_AT_LEVEL + depressionDeg * PER_DEGREE))
	);
</script>

<!-- MapLibre 3D Sky Dome, Rayleigh Haze & Horizon Mist -->
<SkyDome
	sky-color={cssRgb(skyTop)}
	horizon-color={cssRgb(skyHorizon)}
	fog-color={cssRgb(fogColor)}
	sky-horizon-blend={0.75}
	horizon-fog-blend={0.82}
	fog-ground-blend={groundBlend}
	atmosphere-blend={0.85}
/>

<!-- Circadian Celestial Layer: Solar Radiance & Night Starfield -->
<div
	class="sky-celestial-overlay"
	style:--night={night}
	style:--dusk={duskFactor}
	style:--sun-x="{sunScreenX}%"
	aria-hidden="true"
>
	<!-- Golden Hour Solar Flare Radiance -->
	{#if duskFactor > 0.05}
		<div class="dusk-radiance" style:opacity={duskFactor * (1 - night)}></div>
	{/if}

	<!-- Deep Space Milky Way & Starfield (Fades in at night) -->
	<div class="starfield" style:opacity={night} style:--horizon="{horizonPct}%">
		<div class="milky-way"></div>
		{#each STARS as star}
			<div
				class="star"
				style:left="{star.x}%"
				style:top="{star.y}%"
				style:width="{star.size}px"
				style:height="{star.size}px"
				style:--base-op={star.opacity}
				style:animation-duration="{star.twinkleDuration}s"
				style:animation-delay="{star.twinkleDelay}s"
			></div>
		{/each}
	</div>
</div>

<style>
	/* This used to `rotate(var(--view-bank))`, on the stated grounds that the
	   horizon tilts with the airframe. It does not. Bank never reaches the map
	   as roll -- `calculateCameraOptionsFromTo` derives bearing and pitch from
	   geometry and has nothing to derive roll from, and nothing else sets it --
	   so bank reaches the WORLD as a pitch offset (BANK_VIEW_GAIN) and reached
	   this OVERLAY as a rotation. One input, two different visual answers: the
	   stars banked against a horizon that had stayed level, which made the mask
	   error above worse rather than cancelling it.

	   Rolling the map instead is the other way to make these agree, and is
	   probably the better-looking one -- MapLibre takes `roll` in CameraOptions
	   -- but bank is already spent on pitch, so it needs that double-count
	   resolved first. That is a camera design decision, not a bug fix. */
	.sky-celestial-overlay {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		z-index: 1;
	}

	.dusk-radiance {
		position: absolute;
		bottom: 20%;
		left: var(--sun-x);
		width: 140vw;
		height: 60vh;
		translate: -50% 50%;
		background: radial-gradient(
			ellipse at center,
			rgba(255, 140, 40, 0.75) 0%,
			rgba(240, 90, 60, 0.45) 35%,
			rgba(140, 40, 110, 0.2) 65%,
			transparent 85%
		);
		filter: blur(24px);
		pointer-events: none;
	}

	.starfield {
		position: absolute;
		inset: 0;
		/* No `transition` here. `night` is derived from the sun and already
		   moves smoothly; a CSS transition on it would make the fade a function
		   of each pane's frame timing rather than of the wall clock. */
		/* Sky only. Below the horizon there is ground, sea or cloud, and a star
		   drawn there reads as a dead pixel. Faded rather than cut, so the
		   boundary does not draw a hard line across the haze. It inherits the
		   parent's bank rotation for free, which is what we want -- the horizon
		   tilts with the airframe. */
		mask-image: linear-gradient(
			to bottom,
			#000 0,
			#000 calc(var(--horizon) - 12%),
			transparent var(--horizon)
		);
	}

	.milky-way {
		position: absolute;
		top: -20%;
		left: 10%;
		width: 120%;
		height: 100%;
		rotate: -35deg;
		background: radial-gradient(
			ellipse 80% 30% at 50% 50%,
			rgba(130, 160, 220, 0.18) 0%,
			rgba(90, 120, 180, 0.08) 45%,
			transparent 75%
		);
		filter: blur(32px);
	}

	.star {
		position: absolute;
		border-radius: 50%;
		background: #ffffff;
		box-shadow: 0 0 4px rgba(255, 255, 255, 0.8);
		animation: star-twinkle infinite ease-in-out alternate;
	}

	@keyframes star-twinkle {
		0% {
			opacity: calc(var(--base-op) * 0.35);
			transform: scale(0.8);
		}
		50% {
			opacity: var(--base-op);
			transform: scale(1.15);
		}
		100% {
			opacity: calc(var(--base-op) * 0.6);
			transform: scale(0.9);
		}
	}
</style>
