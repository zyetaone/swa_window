<script lang="ts">
	/**
	 * NightOverlay — artistic atmospheric embellishments for the scene.
	 *
	 * Layers (z-order, bottom-up):
	 *   stars      — CSS star-field above horizon; visible only at night
	 *   shimmer    — full-viewport SVG feTurbulence applied as a subtle
	 *                displacement filter; reads as heat-haze / air-motion
	 *   moon       — DOM element at a calculated sky position
	 *
	 * All driven by `nightFactor` (0 = day, 1 = night). Shimmer runs at all
	 * hours but is more visible at dusk/dawn where warm/cool color gradients
	 * bend. Moon appears past nightFactor > 0.3.
	 */

	let { nightFactor = 0 }: { nightFactor?: number } = $props();

	const starsOpacity = $derived(Math.max(0, nightFactor - 0.1));
	const moonOpacity = $derived(Math.max(0, (nightFactor - 0.3) * 1.5));
	// Shimmer peaks at dawn/dusk, fades at noon and midnight
	const shimmerStrength = $derived(1 - Math.abs(nightFactor - 0.5) * 2);
</script>

<!-- Stars — sits above the MapLibre canvas. Absolute positioned; covers
     upper 55% of viewport (below horizon we see terrain). -->
<div class="stars" style:opacity={starsOpacity} aria-hidden="true">
	<div class="star-layer star-layer-1"></div>
	<div class="star-layer star-layer-2"></div>
	<div class="star-layer star-layer-3"></div>
</div>

<!-- Moon — small disc positioned upper-right with halo glow. -->
<div class="moon-container" style:opacity={moonOpacity} aria-hidden="true">
	<div class="moon-halo"></div>
	<div class="moon-disc"></div>
</div>

<!-- Atmospheric shimmer — subtle feTurbulence animated on baseFrequency.
     Masked to lower half of viewport (where haze over ground/water lives).
     Amplitude scaled by shimmerStrength so it peaks at golden hour. -->
<svg class="shimmer" style:opacity={shimmerStrength * 0.45} aria-hidden="true">
	<defs>
		<filter id="haze-turb">
			<feTurbulence type="fractalNoise" baseFrequency="0.008 0.004" numOctaves="2" seed="2">
				<animate
					attributeName="baseFrequency"
					dur="23s"
					values="0.008 0.004; 0.012 0.005; 0.008 0.004"
					repeatCount="indefinite"
				/>
			</feTurbulence>
			<feColorMatrix
				type="matrix"
				values="0 0 0 0 1
				        0 0 0 0 1
				        0 0 0 0 1
				        0 0 0 0.06 0"
			/>
		</filter>
		<linearGradient id="haze-mask" x1="0%" y1="0%" x2="0%" y2="100%">
			<stop offset="0%" stop-color="white" stop-opacity="0" />
			<stop offset="45%" stop-color="white" stop-opacity="0" />
			<stop offset="65%" stop-color="white" stop-opacity="1" />
			<stop offset="100%" stop-color="white" stop-opacity="0.6" />
		</linearGradient>
		<mask id="haze-cutoff"><rect width="100%" height="100%" fill="url(#haze-mask)" /></mask>
	</defs>
	<rect width="100%" height="100%" filter="url(#haze-turb)" mask="url(#haze-cutoff)" />
</svg>

<style>
	.stars, .shimmer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 8;
		transition: opacity 1.5s ease;
	}

	.stars { overflow: hidden; }

	/* Three overlapping star layers with different sizes — parallax feel */
	.star-layer {
		position: absolute;
		inset: 0;
		background-repeat: repeat;
	}
	.star-layer-1 {
		background-image: radial-gradient(1px 1px at 20px 30px, #fff, transparent),
			radial-gradient(1px 1px at 80px 120px, #fff, transparent),
			radial-gradient(1px 1px at 150px 80px, #fff, transparent),
			radial-gradient(1px 1px at 200px 220px, rgba(255,255,220,0.9), transparent),
			radial-gradient(1px 1px at 320px 90px, #fff, transparent),
			radial-gradient(1px 1px at 400px 200px, #fff, transparent);
		background-size: 450px 280px;
		opacity: 0.9;
	}
	.star-layer-2 {
		background-image: radial-gradient(0.8px 0.8px at 60px 80px, rgba(220,220,255,0.8), transparent),
			radial-gradient(0.8px 0.8px at 140px 40px, #fff, transparent),
			radial-gradient(0.8px 0.8px at 280px 180px, #fff, transparent),
			radial-gradient(0.8px 0.8px at 390px 60px, rgba(255,240,220,0.8), transparent);
		background-size: 520px 320px;
		opacity: 0.6;
		animation: twinkle 7s ease-in-out infinite alternate;
	}
	.star-layer-3 {
		background-image: radial-gradient(0.6px 0.6px at 30px 60px, rgba(255,255,255,0.5), transparent),
			radial-gradient(0.6px 0.6px at 220px 140px, rgba(200,220,255,0.5), transparent),
			radial-gradient(0.6px 0.6px at 380px 40px, #fff, transparent);
		background-size: 600px 400px;
		opacity: 0.4;
		animation: twinkle 5s ease-in-out infinite alternate-reverse;
	}

	@keyframes twinkle {
		from { opacity: 0.3; }
		to   { opacity: 0.7; }
	}

	.moon-container {
		position: absolute;
		top: 12%;
		right: 15%;
		width: 90px;
		height: 90px;
		pointer-events: none;
		z-index: 8;
		transition: opacity 1.5s ease;
	}
	.moon-halo {
		position: absolute;
		inset: -40px;
		background: radial-gradient(circle, rgba(244, 241, 229, 0.22) 0%, rgba(244, 241, 229, 0.05) 40%, transparent 65%);
		border-radius: 50%;
	}
	.moon-disc {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 35% 30%, #fbfaf3 0%, #eeeade 55%, #d9d5c4 100%);
		border-radius: 50%;
		box-shadow:
			inset -8px -6px 14px rgba(160, 150, 120, 0.35),
			0 0 16px rgba(244, 241, 229, 0.5);
	}

	.shimmer {
		width: 100%;
		height: 100%;
	}
</style>
