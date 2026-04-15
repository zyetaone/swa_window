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

<!-- Hidden SVG defs — zero-size container.
     Filter chain per layer (adapted from Yannakopoulos + ccprog's variant):
       pre-blur  →  softens the ellipse edge so displacement doesn't carve holes
       turbulence →  fractal noise as the displacement source
       displace   →  warp the soft ellipse into cloud silhouette
       post-blur  →  final feathering for wispy edges
       colorMatrix →  invert RGB so black seed becomes white cloud
     Filter region x/y/width/height enlarged to 150% so distortion doesn't clip. -->
<svg class="defs" aria-hidden="true">
	<defs>
		<filter id="cloud-back" x="-25%" y="-25%" width="150%" height="150%">
			<feGaussianBlur in="SourceGraphic" stdDeviation="6" result="pre" />
			<feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="1" result="noise">
				{#if animate}
					<animate attributeName="baseFrequency" dur="48s"
						values="0.011;0.015;0.011" repeatCount="indefinite" />
				{/if}
			</feTurbulence>
			<feDisplacementMap in="pre" in2="noise" scale="70" result="disp" />
			<feGaussianBlur in="disp" stdDeviation="4" result="soft" />
			<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
		</filter>

		<filter id="cloud-mid" x="-25%" y="-25%" width="150%" height="150%">
			<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="pre" />
			<feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="2" seed="2" result="noise">
				{#if animate}
					<animate attributeName="baseFrequency" dur="32s"
						values="0.014;0.018;0.014" repeatCount="indefinite" />
				{/if}
			</feTurbulence>
			<feDisplacementMap in="pre" in2="noise" scale="55" result="disp" />
			<feGaussianBlur in="disp" stdDeviation="3" result="soft" />
			<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
		</filter>

		<filter id="cloud-front" x="-25%" y="-25%" width="150%" height="150%">
			<feGaussianBlur in="SourceGraphic" stdDeviation="4" result="pre" />
			<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="3" result="noise">
				{#if animate}
					<animate attributeName="baseFrequency" dur="20s"
						values="0.017;0.022;0.017" repeatCount="indefinite" />
				{/if}
			</feTurbulence>
			<feDisplacementMap in="pre" in2="noise" scale="45" result="disp" />
			<feGaussianBlur in="disp" stdDeviation="2.5" result="soft" />
			<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
		</filter>
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
	<!-- Cloud layers with CSS perspective + translateZ for real depth parallax.
	     The viewport perspective gives each layer its own apparent motion rate
	     when the parent transforms. Position jitter via cloudPhase sin waves. -->
	{#if showBack}
		<!-- Far cirrus — tiny wisps receding into upper sky, light jitter -->
		<div class="cloud-layer back" style:animation-duration={backDuration}>
			<div class="seed cirrus" style:top="{jitter(0, 8, 1.5, 0.7)}%"  style:left="{jitter(0, 5, 2, 0.3)}%"></div>
			<div class="seed cirrus" style:top="{jitter(1, 11, 1.5, 0.9)}%" style:left="{jitter(1, 18, 2, 0.3)}%"></div>
			<div class="seed cirrus" style:top="{jitter(2, 10, 1.5, 0.8)}%" style:left="{jitter(2, 32, 2, 0.3)}%"></div>
			<div class="seed cirrus" style:top="{jitter(3, 9, 1.5, 0.7)}%"  style:left="{jitter(3, 47, 2, 0.3)}%"></div>
			<div class="seed cirrus" style:top="{jitter(4, 12, 1.5, 0.8)}%" style:left="{jitter(4, 62, 2, 0.3)}%"></div>
			<div class="seed cirrus" style:top="{jitter(5, 10, 1.5, 0.9)}%" style:left="{jitter(5, 78, 2, 0.3)}%"></div>
			<div class="seed cirrus" style:top="{jitter(6, 8, 1.5, 0.7)}%"  style:left="{jitter(6, 90, 2, 0.3)}%"></div>
		</div>
	{/if}
	{#if showMid}
		<!-- HORIZON BAND — biggest clouds; stronger jitter since they're the
		     visual anchor of the scene -->
		<div class="cloud-layer mid" style:animation-duration={midDuration}>
			<div class="seed horizon" style:top="{jitter(10, 28, 2.5, 0.4)}%" style:left="{jitter(10, 2, 3, 0.25)}%"></div>
			<div class="seed horizon" style:top="{jitter(11, 31, 2.5, 0.5)}%" style:left="{jitter(11, 16, 3, 0.25)}%"></div>
			<div class="seed horizon" style:top="{jitter(12, 29, 2.5, 0.4)}%" style:left="{jitter(12, 30, 3, 0.25)}%"></div>
			<div class="seed horizon" style:top="{jitter(13, 32, 2.5, 0.5)}%" style:left="{jitter(13, 44, 3, 0.25)}%"></div>
			<div class="seed horizon" style:top="{jitter(14, 30, 2.5, 0.4)}%" style:left="{jitter(14, 58, 3, 0.25)}%"></div>
			<div class="seed horizon" style:top="{jitter(15, 31, 2.5, 0.5)}%" style:left="{jitter(15, 72, 3, 0.25)}%"></div>
			<div class="seed horizon" style:top="{jitter(16, 29, 2.5, 0.4)}%" style:left="{jitter(16, 86, 3, 0.25)}%"></div>
		</div>
	{/if}
	{#if showFront}
		<!-- Foreground wisps — largest jitter, come and go -->
		<div class="cloud-layer front" style:animation-duration={frontDuration}>
			<div class="seed mid-cloud" style:top="{jitter(20, 22, 3, 0.3)}%" style:left="{jitter(20, 24, 5, 0.15)}%"></div>
			<div class="seed mid-cloud" style:top="{jitter(21, 20, 3, 0.3)}%" style:left="{jitter(21, 66, 5, 0.15)}%"></div>
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

	/* Size variants per perspective */
	.seed.cirrus    { width: 8%;  aspect-ratio: 3.5 / 1; opacity: 0.55; }
	.seed.horizon   { width: 22%; aspect-ratio: 2.4 / 1; opacity: 0.88; }
	.seed.mid-cloud { width: 14%; aspect-ratio: 2.6 / 1; opacity: 0.7; }

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

	.cloud-layer.back .seed {
		filter: url(#cloud-back);
		transform: scale(0.85);
	}
	.cloud-layer.mid .seed {
		filter: url(#cloud-mid);
		transform: scale(1.0);
	}
	.cloud-layer.front .seed {
		filter: url(#cloud-front);
		transform: scale(1.15);
	}

	@keyframes cloud-drift {
		from { transform: translate(-15%, -8%); }
		to   { transform: translate(calc(var(--drift-x) * 40%), calc(var(--drift-y) * 20%)); }
	}

	@media (prefers-reduced-motion: reduce) {
		.cloud-layer { animation: none; }
	}
</style>
