<script lang="ts">
	/**
	 * PhotoClouds — realistic SVG clouds via feTurbulence + feDisplacementMap +
	 * feColorMatrix inversion. No offscreen-seed tricks — the filter chain
	 * itself turns a dark ellipse into a soft white cloud in place.
	 *
	 * Pipeline per layer:
	 *   feTurbulence (fractal noise, animated baseFrequency)
	 *   → feDisplacementMap (warps the black ellipse into cloud silhouette)
	 *   → feGaussianBlur (softens edges)
	 *   → feColorMatrix (inverts RGB → black becomes white, keeps alpha)
	 *   → feComposite (clamp alpha to the distorted shape)
	 *
	 * Three parallax depth layers at different displacement scales + octaves.
	 *
	 * Inspired by: https://css-tricks.com/drawing-realistic-clouds-with-svg-and-css/
	 * (adapted with feColorMatrix so we don't need the box-shadow trick).
	 */

	let {
		density = 0.6,
		speed = 1.0,
		heading = 90,
		windAngle = 0,
		nightFactor = 0,
		/** Enable animated turbulence (baseFrequency animation). Slight CPU cost. */
		animate = true,
	}: {
		density?: number;
		speed?: number;
		heading?: number;
		windAngle?: number;
		nightFactor?: number;
		animate?: boolean;
	} = $props();

	// Drift angle — clouds push opposite to plane heading, offset by wind
	const driftAngle = $derived((heading + windAngle + 180) % 360);
	const driftRad = $derived((driftAngle * Math.PI) / 180);
	const driftX = $derived(Math.cos(driftRad));
	const driftY = $derived(Math.sin(driftRad) * 0.35);

	// Per-layer drift durations (closer = faster)
	const backDuration = $derived(`${90 / Math.max(speed, 0.01)}s`);
	const midDuration = $derived(`${55 / Math.max(speed, 0.01)}s`);
	const frontDuration = $derived(`${30 / Math.max(speed, 0.01)}s`);

	// Density thresholds
	const showBack = $derived(density > 0.1);
	const showMid = $derived(density > 0.3);
	const showFront = $derived(density > 0.55);
	const layerOpacity = $derived(Math.min(1, density * 1.1));

	// Cloud tint via feColorMatrix: day=warm white, night=cool pale blue.
	// Output channel bias: R, G, B offsets added after inversion.
	const rOffset = $derived(nightFactor > 0.5 ? 0.68 : 0.98);
	const gOffset = $derived(nightFactor > 0.5 ? 0.72 : 0.95);
	const bOffset = $derived(nightFactor > 0.5 ? 0.82 : 0.92);
	const alphaOffset = $derived(nightFactor > 0.5 ? -0.15 : 0);

	// Build dynamic colorMatrix string. Inverts RGB (-1 diagonal) then adds
	// our tint offsets. Alpha passes through with optional dim at night.
	const colorMatrix = $derived(
		`-1 0 0 0 ${rOffset}  0 -1 0 0 ${gOffset}  0 0 -1 0 ${bOffset}  0 0 0 1 ${alphaOffset}`,
	);

	// ── Cloud phase — RAF-tracked slow seed for per-cloud random sway ───────
	// Each seed reads `cloudPhase + idx × π/N` → sin/cos → position/size
	// offsets. This gives every cloud an independent jitter cycle even
	// though they share the same feTurbulence filter.
	let cloudPhase = $state(0);
	$effect(() => {
		let raf: number;
		let last = performance.now();
		const loop = (now: number) => {
			cloudPhase += ((now - last) / 1000) * 0.05 * speed; // slow drift
			last = now;
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	// Per-seed position jitter — deterministic sin waves off cloudPhase + idx
	function jitter(idx: number, base: number, amp: number, freq: number): number {
		return base + Math.sin(cloudPhase * freq + idx * 1.91) * amp;
	}
</script>

<!-- Five seed variants per layer so sibling clouds get different shapes.
     Share the same filter chain template but vary feTurbulence `seed` +
     slight baseFrequency drift so no two clouds look identical. -->
<svg class="defs" aria-hidden="true">
	<defs>
		{#each [1, 7, 13, 19, 31] as seedNum, i (seedNum)}
			<filter id="cloud-back-{i}" x="-25%" y="-25%" width="150%" height="150%">
				<feGaussianBlur in="SourceGraphic" stdDeviation="6" result="pre" />
				<feTurbulence type="fractalNoise" baseFrequency={0.010 + i * 0.002} numOctaves="3" seed={seedNum} result="noise">
					{#if animate}
						<animate attributeName="baseFrequency" dur="{42 + i * 3}s"
							values="{0.010 + i * 0.002};{0.013 + i * 0.002};{0.010 + i * 0.002}" repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feDisplacementMap in="pre" in2="noise" scale={65 + i * 5} result="disp" />
				<feGaussianBlur in="disp" stdDeviation="4" result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>

			<filter id="cloud-mid-{i}" x="-25%" y="-25%" width="150%" height="150%">
				<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="pre" />
				<feTurbulence type="fractalNoise" baseFrequency={0.014 + i * 0.002} numOctaves="2" seed={seedNum + 100} result="noise">
					{#if animate}
						<animate attributeName="baseFrequency" dur="{28 + i * 2}s"
							values="{0.014 + i * 0.002};{0.017 + i * 0.002};{0.014 + i * 0.002}" repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feDisplacementMap in="pre" in2="noise" scale={50 + i * 4} result="disp" />
				<feGaussianBlur in="disp" stdDeviation="3" result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>

			<filter id="cloud-front-{i}" x="-25%" y="-25%" width="150%" height="150%">
				<feGaussianBlur in="SourceGraphic" stdDeviation="4" result="pre" />
				<feTurbulence type="fractalNoise" baseFrequency={0.017 + i * 0.002} numOctaves="2" seed={seedNum + 200} result="noise">
					{#if animate}
						<animate attributeName="baseFrequency" dur="{18 + i}s"
							values="{0.017 + i * 0.002};{0.021 + i * 0.002};{0.017 + i * 0.002}" repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feDisplacementMap in="pre" in2="noise" scale={40 + i * 3} result="disp" />
				<feGaussianBlur in="disp" stdDeviation="2.5" result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>
		{/each}
	</defs>
</svg>

<div
	class="photo-clouds"
	style:opacity={layerOpacity}
	style:--drift-x={driftX}
	style:--drift-y={driftY}
	aria-hidden="true"
>
	<!-- Density rule: dense carpet of SMALL far clouds near the horizon,
	     sparser + larger clouds as we descend toward the viewer. This
	     matches what you see from a cruise window above a cloud deck. -->
	<!-- At pitch 76° the horizon sits ~35% from viewport top. Clouds should
	     cluster AT that band (distance scaled up per perspective — cumulus
	     looks biggest at horizon, smaller in foreground). Above horizon we
	     taper to wispy high cirrus; below we never place clouds (the camera
	     is above them at cruise altitude). -->
	<!--
	 Physics model: plane at cruise 30k ft is ABOVE typical cumulus.
	 Layers, top-down on the viewport:
	   1. CIRRUS   — high ice clouds at 40-60k ft, ABOVE horizon line.
	                 Wispy, elongated, sparse. Occupy the SKY band (top 8-25%).
	   2. HORIZON  — mid-altitude cumulus tops visible AT horizon line.
	                 Few, prominent, largest (perspective peak).
	   3. DECK     — cumulus deck we're FLYING OVER, below horizon.
	                 Below the horizon line (45-70% from top). We see the
	                 TOPS of these clouds stretching away from us.
	 -->
	{#if showBack}
		<!-- CIRRUS — high wispy ice clouds in the upper sky, spread wide -->
		<div class="cloud-layer back" style:animation-duration={backDuration}>
			{#each Array(10) as _, i}
				<div class="seed cirrus"
					style:top="{jitter(i, 10 + (i % 3) * 5, 1.5, 0.5)}%"
					style:left="{jitter(i, 5 + i * 10, 2, 0.2)}%"></div>
			{/each}
		</div>
	{/if}
	{#if showMid}
		<!-- HORIZON cumulus tops — 4-5 prominent shapes at the horizon line -->
		<div class="cloud-layer mid" style:animation-duration={midDuration}>
			{#each Array(5) as _, i}
				<div class="seed horizon"
					style:top="{jitter(i + 10, 30, 1.5, 0.3)}%"
					style:left="{jitter(i + 10, 8 + i * 20, 2.5, 0.2)}%"></div>
			{/each}
		</div>
	{/if}
	{#if showFront}
		<!-- DECK below — cumulus tops we're flying over. Below horizon line.
		     Bigger as they come closer toward the bottom of frame
		     (foreground perspective). -->
		<div class="cloud-layer front" style:animation-duration={frontDuration}>
			<div class="seed deck-far"  style:top="{jitter(20, 46, 1, 0.3)}%"  style:left="{jitter(20, 10, 3, 0.2)}%"></div>
			<div class="seed deck-far"  style:top="{jitter(21, 48, 1, 0.35)}%" style:left="{jitter(21, 35, 3, 0.2)}%"></div>
			<div class="seed deck-far"  style:top="{jitter(22, 45, 1, 0.3)}%"  style:left="{jitter(22, 62, 3, 0.2)}%"></div>
			<div class="seed deck-far"  style:top="{jitter(23, 47, 1, 0.35)}%" style:left="{jitter(23, 85, 3, 0.2)}%"></div>
			<div class="seed deck-near" style:top="{jitter(24, 60, 2, 0.25)}%" style:left="{jitter(24, 20, 4, 0.15)}%"></div>
			<div class="seed deck-near" style:top="{jitter(25, 62, 2, 0.3)}%"  style:left="{jitter(25, 70, 4, 0.15)}%"></div>
			<div class="seed deck-closest" style:top="{jitter(26, 75, 3, 0.2)}%" style:left="{jitter(26, 48, 6, 0.12)}%"></div>
		</div>
	{/if}
</div>

<style>
	.defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	.photo-clouds {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 5;
		overflow: hidden;
		will-change: opacity;
		transition: opacity 1.5s ease;
		/* 3D perspective so per-layer translateZ gives real parallax.
		   Far clouds move less than near clouds when the parent shakes
		   (motion transform on .globe-pane or viewport-btn). */
		perspective: 1200px;
		perspective-origin: 50% 40%;  /* slightly above center, near horizon */
		transform-style: preserve-3d;
	}

	.cloud-layer {
		position: absolute;
		inset: 0;
		animation-name: cloud-drift;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
	}

	.seed {
		position: absolute;
		width: 18%;
		aspect-ratio: 2 / 1;
		background: #000;
		border-radius: 50%;
		opacity: 0.9;
	}

	/* Size + opacity per physics tier:
	   - cirrus:       wispy, transparent, elongated (high ice clouds)
	   - horizon:      cumulus tops AT horizon, biggest, opaque
	   - deck-far:     distant deck below us, narrow bands (perspective foreshort)
	   - deck-near:    mid-deck, medium
	   - deck-closest: closest deck top, large, foreground */
	.seed.cirrus        { width: 10%; aspect-ratio: 4.5 / 1; opacity: 0.45; }
	.seed.horizon       { width: 20%; aspect-ratio: 2.2 / 1; opacity: 0.9; }
	.seed.deck-far      { width: 14%; aspect-ratio: 3 / 1;   opacity: 0.75; }
	.seed.deck-near     { width: 20%; aspect-ratio: 2.5 / 1; opacity: 0.85; }
	.seed.deck-closest  { width: 30%; aspect-ratio: 2.2 / 1; opacity: 0.9; }

	/* Per-seed shape variance — same filter, but pre-displacement rotation
	   + non-uniform scale break the 'copied shape' pattern. Seven unique
	   profiles cycled across siblings via :nth-of-type. */
	.cloud-layer .seed:nth-of-type(7n+1) { transform: scale(1.0, 0.9) rotate(-6deg); }
	.cloud-layer .seed:nth-of-type(7n+2) { transform: scale(0.85, 1.1) rotate(10deg); }
	.cloud-layer .seed:nth-of-type(7n+3) { transform: scale(1.15, 0.8) rotate(-3deg); }
	.cloud-layer .seed:nth-of-type(7n+4) { transform: scale(0.9, 1.05) rotate(14deg); }
	.cloud-layer .seed:nth-of-type(7n+5) { transform: scale(1.05, 0.95) rotate(-11deg); }
	.cloud-layer .seed:nth-of-type(7n+6) { transform: scale(0.95, 1.15) rotate(4deg); }
	.cloud-layer .seed:nth-of-type(7n+7) { transform: scale(1.1, 0.85) rotate(-8deg); }

	/* Cycle through 5 seed variants via nth-of-type. Each variant is a
	   distinct feTurbulence seed so sibling clouds have unique shapes
	   instead of reading as a single connected blob. */
	.cloud-layer.back  .seed:nth-of-type(5n+1) { filter: url(#cloud-back-0); }
	.cloud-layer.back  .seed:nth-of-type(5n+2) { filter: url(#cloud-back-1); translate: 0 0; }
	.cloud-layer.back  .seed:nth-of-type(5n+3) { filter: url(#cloud-back-2); }
	.cloud-layer.back  .seed:nth-of-type(5n+4) { filter: url(#cloud-back-3); }
	.cloud-layer.back  .seed:nth-of-type(5n)   { filter: url(#cloud-back-4); }

	.cloud-layer.mid   .seed:nth-of-type(5n+1) { filter: url(#cloud-mid-0); }
	.cloud-layer.mid   .seed:nth-of-type(5n+2) { filter: url(#cloud-mid-1); }
	.cloud-layer.mid   .seed:nth-of-type(5n+3) { filter: url(#cloud-mid-2); }
	.cloud-layer.mid   .seed:nth-of-type(5n+4) { filter: url(#cloud-mid-3); }
	.cloud-layer.mid   .seed:nth-of-type(5n)   { filter: url(#cloud-mid-4); }

	.cloud-layer.front .seed:nth-of-type(5n+1) { filter: url(#cloud-front-0); }
	.cloud-layer.front .seed:nth-of-type(5n+2) { filter: url(#cloud-front-1); }
	.cloud-layer.front .seed:nth-of-type(5n+3) { filter: url(#cloud-front-2); }
	.cloud-layer.front .seed:nth-of-type(5n+4) { filter: url(#cloud-front-3); }
	.cloud-layer.front .seed:nth-of-type(5n)   { filter: url(#cloud-front-4); }

	@keyframes cloud-drift {
		from { transform: translate(-15%, -8%); }
		to   { transform: translate(calc(var(--drift-x) * 40%), calc(var(--drift-y) * 20%)); }
	}

	@media (prefers-reduced-motion: reduce) {
		.cloud-layer { animation: none; }
	}
</style>
