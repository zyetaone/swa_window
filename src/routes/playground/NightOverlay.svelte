<script lang="ts">
	/**
	 * NightOverlay — unified atmospheric overlay for the scene.
	 *
	 * Combines what were previously three separate components:
	 *   - NightOverlay   (stars, moon, shooting stars, shimmer, city glow)
	 *   - LensFlare      (sun-tracking optical flare)
	 *   - atmo-haze div  (screen-blended sky color grading)
	 *
	 * All driven by `nightFactor`, `timeOfDay`, `skyState`, and `viewBearing`.
	 */

	import type { SkyState } from '$lib/types';

	let {
		nightFactor = 0,
		timeOfDay = 0,
		skyState = 'day' as SkyState,
		viewBearing = 90,
	}: {
		nightFactor?: number;
		timeOfDay?: number;
		skyState?: SkyState;
		viewBearing?: number;
	} = $props();

	// ── Atmospheric haze gradient — color-grades the entire scene ─────────────
	const hazeGradient = $derived.by(() => {
		switch (skyState) {
			case 'night': return 'linear-gradient(180deg, rgba(20,28,50,0.55) 0%, rgba(10,16,35,0.4) 40%, rgba(5,8,18,0.3) 100%)';
			case 'dawn':  return 'linear-gradient(180deg, rgba(220,150,110,0.35) 0%, rgba(240,180,120,0.25) 45%, rgba(200,160,100,0.15) 100%)';
			case 'dusk':  return 'linear-gradient(180deg, rgba(200,110,90,0.4) 0%, rgba(180,90,70,0.3) 40%, rgba(100,60,50,0.2) 100%)';
			default:      return 'linear-gradient(180deg, rgba(170,195,220,0.3) 0%, rgba(190,210,230,0.2) 50%, rgba(160,180,160,0.1) 100%)';
		}
	});

	// ── Dark void crush — vignette that darkens terrain edges at night.
	//    Production shader: terrain dimmed 30% at night. This CSS radial
	//    gradient creates a similar "city light swallowed by darkness" feel.
	const voidOpacity = $derived(Math.max(0, (nightFactor - 0.25) * 0.45));

	// ── Dawn/dusk rim light — warm wash on the left frame edge during
	//    transition hours. Production shader's directional rim light.
	const rimOpacity = $derived.by(() => {
		if (skyState === 'dawn') return Math.min(1, nightFactor * 1.2) * 0.25;
		if (skyState === 'dusk') return Math.min(1, nightFactor * 1.2) * 0.25;
		return 0;
	});

	const starsOpacity = $derived(Math.max(0, nightFactor - 0.1));
	const shimmerStrength = $derived(1 - Math.abs(nightFactor - 0.5) * 2);

	// ── Lens flare ─────────────────────────────────────────────────────────
	const sunAzimuth = $derived((timeOfDay * 15) % 360);
	const sunBearingDiff = $derived.by(() => {
		return (sunAzimuth - viewBearing + 540) % 360 - 180;
	});
	const sunAlignment = $derived.by(() => {
		if (skyState === 'night') return 0;
		return Math.max(0, Math.min(1, 1 - Math.abs(sunBearingDiff) / 40));
	});
	const sunScreenX = $derived(Math.max(5, Math.min(95, 50 + (sunBearingDiff / 40) * 45)));
	const sunScreenY = $derived.by(() => {
		const hourAngle = (timeOfDay - 12) * 15;
		const elevation = Math.cos(hourAngle * Math.PI / 180);
		return Math.max(10, Math.min(70, 45 - elevation * 30));
	});

	const lensOpacity = $derived(sunAlignment * (skyState === 'day' ? 0.85 : 0.6));
	const ghostX = $derived(100 - sunScreenX);
	const ghostY = $derived(100 - sunScreenY);
	const streakAngle = $derived((sunScreenX - 50) * 0.15);

	// ── Moon phase (removed — not part of skybox) ──────────────────────────

	// ── Star rotation — slow drift reflecting earth rotation ───────────────
	const starsAngle = $derived((timeOfDay * 15) % 360);

	// ── Shooting stars ────────────────────────────────────────────────────
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

<!-- Atmospheric haze — screen-blended sky color grading overlay.
     Matches prod atmosphere/haze/effect.svelte: dawn=warm amber, night=deep navy,
     day=cool atmospheric blue. Softens LOD seams + unifies color grade. -->
<div class="haze" style:background={hazeGradient} aria-hidden="true"></div>

<!-- Dark void crush — radial vignette darkening terrain edges at night.
     Production shader: terrain dimmed 30% at night. Creates the "city lights
     swallowed by darkness" feel — the world fades to black at the edges. -->
<div class="void-crush" style:opacity={voidOpacity} aria-hidden="true"></div>

<!-- Dawn/dusk rim light — warm wash on the left frame edge during transition.
     Production shader's directional rim light: left-frame warm wash at dawn/dusk. -->
{#if rimOpacity > 0.01}
	<div class="rim-light" style:opacity={rimOpacity} aria-hidden="true"></div>
{/if}

<!-- Lens flare — sun-tracking optical flare (ghost ring, halo, streak).
     Ghost is mirrored through viewport center (lens optics). -->
{#if sunAlignment > 0.01}
	<div class="lens-flare" style:opacity={lensOpacity} aria-hidden="true">
		<div class="flare-core" style:left="{sunScreenX}%" style:top="{sunScreenY}%"></div>
		<div class="flare-halo" style:left="{sunScreenX}%" style:top="{sunScreenY}%"></div>
		<div class="flare-ghost" style:left="{ghostX}%" style:top="{ghostY}%" style:opacity={sunAlignment * 0.4}></div>
		<div class="flare-ghost-sm"
			style:left="{50 + (ghostX - 50) * 0.5}%"
			style:top="{50 + (ghostY - 50) * 0.5}%"
			style:opacity={sunAlignment * 0.25}></div>
		<div class="flare-streak" style:top="{sunScreenY}%" style:transform="rotate({streakAngle}deg)"></div>
	</div>
{/if}

<!-- Stars — clipped to upper 55% (sky area above horizon). Fades out at
     the bottom edge via mask-image so it doesn't pop-cut at the horizon. -->
<div class="stars" style:opacity={starsOpacity} style:transform="rotate({starsAngle}deg)" aria-hidden="true">
	<div class="star-layer star-layer-1"></div>
	<div class="star-layer star-layer-2"></div>
	<div class="star-layer star-layer-3"></div>
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
	/* ── Atmospheric haze — composite color grading overlay ─────────── */
	.haze {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 4;
		mix-blend-mode: screen;
		transition: background 2s ease;
	}

	/* ── Dark void crush — radial vignette darkening edges at night ─── */
	.void-crush {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 3;
		background: radial-gradient(ellipse 80% 70% at 50% 50%,
			transparent 35%,
			rgba(5, 8, 20, 0.5) 70%,
			rgba(2, 4, 12, 0.75) 100%
		);
		mix-blend-mode: multiply;
		transition: opacity 2s ease;
	}

	/* ── Dawn/dusk rim light — left-edge warm wash ─────────────────── */
	.rim-light {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 5;
		background: linear-gradient(90deg,
			rgba(255, 160, 80, 0.35) 0%,
			rgba(255, 140, 60, 0.12) 15%,
			transparent 40%
		);
		mix-blend-mode: screen;
		transition: opacity 2s ease;
	}

	/* ── Lens flare ─────────────────────────────────────────────────── */
	.lens-flare {
		position: absolute;
		inset: 0;
		pointer-events: none;
		mix-blend-mode: screen;
		transition: opacity 0.3s ease-out;
		z-index: 10;
		overflow: hidden;
	}

	.flare-core {
		position: absolute;
		width: 12vw;
		height: 12vw;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle,
			rgba(255,255,255,1) 0%,
			rgba(255,240,200,0.7) 15%,
			rgba(255,200,120,0.3) 40%,
			rgba(255,180,100,0) 70%
		);
		filter: blur(8px);
	}

	.flare-halo {
		position: absolute;
		width: 30vw;
		height: 30vw;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle,
			rgba(255,200,120,0.12) 0%,
			rgba(255,180,100,0.05) 40%,
			rgba(255,160,80,0) 70%
		);
	}

	.flare-ghost {
		position: absolute;
		width: 8vw;
		height: 8vw;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		border: 1px solid rgba(255, 180, 100, 0.15);
		background: radial-gradient(circle,
			rgba(100, 180, 255, 0.08) 0%,
			rgba(100, 160, 255, 0.03) 50%,
			rgba(100, 140, 255, 0) 70%
		);
	}

	.flare-ghost-sm {
		position: absolute;
		width: 4vw;
		height: 4vw;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle,
			rgba(180, 220, 255, 0.1) 0%,
			rgba(180, 220, 255, 0) 70%
		);
	}

	.flare-streak {
		position: absolute;
		left: 0;
		right: 0;
		height: 3px;
		transform-origin: center;
		background: linear-gradient(90deg,
			rgba(255,200,100,0) 0%,
			rgba(255,220,150,0.15) 20%,
			rgba(255,240,180,0.5) 45%,
			rgba(255,255,255,0.7) 50%,
			rgba(255,240,180,0.5) 55%,
			rgba(255,220,150,0.15) 80%,
			rgba(255,200,100,0) 100%
		);
		filter: blur(1.5px);
	}

	/* ── Stars ──────────────────────────────────────────────────────── */
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

	/* Three star layers with color + size variation:
     - Layer 1: bright white/blue-white, 1.2-1.5px (brighter stars)
     - Layer 2: mid-tone, 0.8-1px (medium stars) + twinkle animation
     - Layer 3: dim small, 0.5-0.7px (distant field)
     Background-size reduced → higher star density per viewport. */
	.star-layer-1 {
		background-image:
			radial-gradient(1.4px 1.4px at 15px 22px, rgba(255,255,255,1), transparent),
			radial-gradient(1.2px 1.2px at 48px 90px, rgba(200,220,255,0.95), transparent),
			radial-gradient(1.5px 1.5px at 95px 45px, rgba(255,255,220,0.9), transparent),
			radial-gradient(1.3px 1.3px at 140px 160px, rgba(255,255,255,1), transparent),
			radial-gradient(1.2px 1.2px at 198px 78px, rgba(220,240,255,0.9), transparent),
			radial-gradient(1.4px 1.4px at 275px 190px, rgba(255,250,230,0.95), transparent),
			radial-gradient(1.1px 1.1px at 340px 55px, rgba(255,255,255,1), transparent),
			radial-gradient(1.3px 1.3px at 410px 130px, rgba(200,220,255,0.9), transparent),
			radial-gradient(1.5px 1.5px at 70px 200px, rgba(255,255,255,1), transparent),
			radial-gradient(1.2px 1.2px at 180px 280px, rgba(255,240,220,0.9), transparent),
			radial-gradient(1.4px 1.4px at 300px 260px, rgba(220,230,255,1), transparent),
			radial-gradient(1.1px 1.1px at 450px 180px, rgba(255,255,255,0.95), transparent);
		background-size: 480px 320px;
		opacity: 0.95;
	}
	.star-layer-2 {
		background-image:
			radial-gradient(0.9px 0.9px at 32px 55px, rgba(220,230,255,0.85), transparent),
			radial-gradient(0.8px 0.8px at 88px 130px, rgba(255,255,255,0.9), transparent),
			radial-gradient(1.0px 1.0px at 155px 38px, rgba(255,250,230,0.85), transparent),
			radial-gradient(0.9px 0.9px at 240px 175px, rgba(200,220,255,0.9), transparent),
			radial-gradient(0.8px 0.8px at 315px 95px, rgba(255,255,255,0.9), transparent),
			radial-gradient(1.0px 1.0px at 390px 220px, rgba(255,240,220,0.85), transparent),
			radial-gradient(0.9px 0.9px at 460px 48px, rgba(220,240,255,0.9), transparent),
			radial-gradient(0.8px 0.8px at 55px 260px, rgba(255,255,255,0.85), transparent),
			radial-gradient(1.0px 1.0px at 130px 300px, rgba(200,220,255,0.9), transparent),
			radial-gradient(0.9px 0.9px at 350px 160px, rgba(255,250,240,0.85), transparent);
		background-size: 500px 340px;
		opacity: 0.7;
		animation: twinkle 7s ease-in-out infinite alternate;
	}
	.star-layer-3 {
		background-image:
			radial-gradient(0.6px 0.6px at 22px 45px, rgba(255,255,255,0.55), transparent),
			radial-gradient(0.5px 0.5px at 80px 120px, rgba(200,220,255,0.5), transparent),
			radial-gradient(0.6px 0.6px at 165px 70px, rgba(255,255,255,0.6), transparent),
			radial-gradient(0.5px 0.5px at 230px 180px, rgba(255,245,230,0.55), transparent),
			radial-gradient(0.6px 0.6px at 310px 95px, rgba(200,230,255,0.5), transparent),
			radial-gradient(0.5px 0.5px at 385px 40px, rgba(255,255,255,0.6), transparent),
			radial-gradient(0.6px 0.6px at 440px 200px, rgba(255,240,220,0.55), transparent),
			radial-gradient(0.5px 0.5px at 60px 290px, rgba(220,240,255,0.5), transparent),
			radial-gradient(0.6px 0.6px at 195px 240px, rgba(255,255,255,0.6), transparent),
			radial-gradient(0.5px 0.5px at 420px 280px, rgba(200,220,255,0.55), transparent);
		background-size: 480px 320px;
		opacity: 0.5;
		animation: twinkle 5s ease-in-out infinite alternate-reverse;
	}

@keyframes twinkle {
		from { opacity: 0.3; }
		to   { opacity: 0.7; }
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
