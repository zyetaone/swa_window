<script lang="ts">
	/**
	 * NightOverlay — artistic atmospheric embellishments for the scene.
	 *
	 * Layers (z-order, bottom-up):
	 *   stars         — CSS star-field above horizon; visible only at night
	 *   shooting-star — occasional random streak; fades after each
	 *   shimmer       — full-viewport SVG feTurbulence; heat-haze / air-motion
	 *   moon          — DOM element; position tracks sun azimuth; phase cycles
	 *
	 * All driven by `nightFactor` (0 = day, 1 = night) and `timeOfDay`.
	 */

	let { nightFactor = 0, timeOfDay = 0 }: { nightFactor?: number; timeOfDay?: number } = $props();

	const starsOpacity = $derived(Math.max(0, nightFactor - 0.1));
	const moonOpacity = $derived(Math.max(0, (nightFactor - 0.3) * 1.5));
	// Shimmer peaks at dawn/dusk, fades at noon and midnight
	const shimmerStrength = $derived(1 - Math.abs(nightFactor - 0.5) * 2);

	// ─── Moon phase ─────────────────────────────────────────────────────────
	// Lunar cycle ~29.5 days. timeOfDay 0-24 → fraction of current "moon day".
	// phaseAngle 0=full, 0.5=new. Derived from a continuous value so it morphs.
	const moonPhaseAngle = $derived((timeOfDay / 24) * 29.5 * Math.PI * 2);
	// Normalised phase 0=full, 0.5=new (waxing fills left→right)
	const moonPhaseNorm = $derived(Math.abs(Math.sin(moonPhaseAngle)));

	// ─── Stars drift — subtle Earth rotation simulation ───────────────────
	const starsAngle = $derived((timeOfDay * 15) % 360);

	// ─── Shooting stars ────────────────────────────────────────────────────
	// Random chance every 4s to fire; visible for 600ms.
	let shootingStar = $state<{ x: number; y: number; angle: number } | null>(null);
	let shootTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleShoot() {
		if (shootTimer) clearTimeout(shootTimer);
		shootTimer = setTimeout(() => {
			if (nightFactor > 0.15) {
				shootingStar = {
					x: Math.random() * 60 + 10,
					y: Math.random() * 35 + 5,
					angle: -(Math.random() * 30 + 20),
				};
				setTimeout(() => { shootingStar = null; scheduleShoot(); }, 600);
			} else {
				scheduleShoot();
			}
		}, 3000 + Math.random() * 5000);
	}

	$effect(() => {
		if (nightFactor > 0.15) scheduleShoot();
		else { shootingStar = null; if (shootTimer) clearTimeout(shootTimer); }
		return () => { if (shootTimer) clearTimeout(shootTimer); };
	});
</script>

<!-- Stars — clipped to upper 55% (sky area above horizon). Fades out at
     the bottom edge via mask-image so it doesn't pop-cut at the horizon. -->
<div class="stars" style:opacity={starsOpacity} style:transform="rotate({starsAngle}deg)" aria-hidden="true">
	<div class="star-layer star-layer-1"></div>
	<div class="star-layer star-layer-2"></div>
	<div class="star-layer star-layer-3"></div>
</div>

<!-- Moon — position tracks sun azimuth (upper-right at midnight). -->
<!-- Crescent via clip-path ellipse: phase 0=full (circle), 0.5=new (thin crescent). -->
	<div
	class="moon-container"
	style:opacity={moonOpacity}
	style:right={12 + (1 - moonPhaseNorm) * 8 + '%'}
	aria-hidden="true"
>
	<div class="moon-halo"></div>
	<!-- Crescent: box-shadow inset creates shadow side. norm=0 (full) → 0% shadow, norm=1 (new) → 45% shadow. -->
	<div
		class="moon-disc"
		style:box-shadow="inset {moonPhaseNorm * 45}% 0 {moonPhaseNorm * 25}% -2px rgba(10,8,5,0.85)"
	></div>
</div>

<!-- Shooting stars — trigger randomly, show for ~0.6s then reset -->
{#if shootingStar}
	<div
		class="shooting-star"
		style:left="{shootingStar.x}%"
		style:top="{shootingStar.y}%"
		style:--angle="{shootingStar.angle}deg"
	></div>
{/if}

<!-- City horizon glow — warm orange haze rising from the terrain-city edge.
     Appears only at night, pulses with a slow flicker. -->
<div
	class="city-glow-haze"
	style:opacity={Math.max(0, (nightFactor - 0.3) * 1.2)}
	aria-hidden="true"
></div>

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

	.stars {
		overflow: hidden;
		/* Clip to upper ~55% of viewport (sky region) with soft fade to the
		   horizon so stars don't hard-cut. */
		-webkit-mask-image: linear-gradient(180deg, black 0%, black 40%, transparent 58%);
		mask-image: linear-gradient(180deg, black 0%, black 40%, transparent 58%);
	}

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
		/* Moon far away — tiny disc near top of sky (upper 8% of viewport),
		   small enough to read as 'distant celestial body' not '3000ft object'.
		   Was 72×72 at 4% top right 18% — made it read as close+low. */
		position: absolute;
		top: 6%;
		right: 12%;
		width: 44px;
		height: 44px;
		pointer-events: none;
		z-index: 8;
		transition: opacity 1.5s ease;
	}
	.moon-halo {
		position: absolute;
		inset: -28px;
		background: radial-gradient(circle, rgba(244, 241, 229, 0.18) 0%, rgba(244, 241, 229, 0.04) 40%, transparent 65%);
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

	/* Shooting star — a white streak that crosses the sky diagonally */
	.shooting-star {
		position: absolute;
		width: 80px;
		height: 1.5px;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.9) 30%, rgba(200, 230, 255, 1) 100%);
		border-radius: 1px;
		transform: rotate(var(--angle, -30deg));
		transform-origin: left center;
		pointer-events: none;
		z-index: 9;
		animation: shoot 0.6s ease-out forwards;
	}

	@keyframes shoot {
		from { opacity: 1; width: 0; }
		to   { opacity: 0; width: 80px; }
	}

	/* Warm city-horizon glow — orange haze rising from the terrain edge */
	.city-glow-haze {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 30%;
		background: radial-gradient(ellipse 100% 60% at 50% 100%, rgba(255, 120, 40, 0.18) 0%, rgba(255, 80, 20, 0.08) 40%, transparent 70%);
		pointer-events: none;
		z-index: 7;
		animation: city-pulse 4s ease-in-out infinite alternate;
	}

	@keyframes city-pulse {
		from { opacity: 0.7; }
		to   { opacity: 1.0; }
	}
</style>
