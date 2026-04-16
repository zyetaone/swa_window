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
	 * Four parallax depth layers: cirrus → back → mid → front.
	 *
	 * Weather morphology: rain/storm drives darker base, denser mass,
	 * heavier displacement. Clear sky = crisp small wisps, fast drift.
	 *
	 * Inspired by: https://css-tricks.com/drawing-realistic-clouds-with-svg-and-css/
	 * (adapted with feColorMatrix so we don't need the box-shadow trick).
	 */

	import type { WeatherType } from '$lib/types';

	let {
		density = 0.6,
		speed = 1.0,
		heading = 90,
		windAngle = 0,
		nightFactor = 0,
		/** Drives cloud morphology: dark base for storm, heavy浑浊 for rain, crisp for clear. */
		weather = 'clear' as WeatherType,
		/** Enable animated turbulence (baseFrequency animation). Slight CPU cost. */
		animate = true,
	}: {
		density?: number;
		speed?: number;
		heading?: number;
		windAngle?: number;
		nightFactor?: number;
		weather?: WeatherType;
		animate?: boolean;
	} = $props();

	// ── Weather morphology ─────────────────────────────────────────────────
	// Storm = dark, slow, heavy displacement. Clear = bright, fast, wispy.
	const wx = $derived.by(() => {
		switch (weather) {
			case 'storm':
				return {
					baseFreqMul:   0.65,  // slower turbulence → bigger lumps
					displaceMul:   1.45,  // heavier warping → storm churn
					blurMul:       1.35,  // softer edges
					opacityMul:    1.15,  // denser mass
					darkR: 0.38, darkG: 0.42, darkB: 0.50,  // dark blue-gray
					morphDurMul:   1.6,   // slow morph cycle
				};
			case 'rain':
				return {
					baseFreqMul:   0.82,
					displaceMul:   1.2,
					blurMul:       1.15,
					opacityMul:    1.05,
					darkR: 0.52, darkG: 0.55, darkB: 0.62,
					morphDurMul:   1.2,
				};
			case 'overcast':
				return {
					baseFreqMul:   0.92,
					displaceMul:   1.05,
					blurMul:       1.0,
					opacityMul:    1.0,
					darkR: 0.68, darkG: 0.70, darkB: 0.75,
					morphDurMul:   1.0,
				};
			case 'cloudy':
				return {
					baseFreqMul:   1.1,
					displaceMul:   0.95,
					blurMul:       0.9,
					opacityMul:    0.9,
					darkR: 0.78, darkG: 0.80, darkB: 0.85,
					morphDurMul:   0.85,
				};
			default: /* clear */
				return {
					baseFreqMul:   1.3,   // faster turbulence → smaller wisps
					displaceMul:   0.75,  // lighter warping → clean shapes
					blurMul:       0.72,
					opacityMul:    0.75,
					darkR: 0.88, darkG: 0.90, darkB: 0.93,
					morphDurMul:   0.6,
				};
		}
	});

	// Drift angle — clouds push opposite to plane heading, offset by wind
	const driftAngle = $derived((heading + windAngle + 180) % 360);
	const driftRad = $derived((driftAngle * Math.PI) / 180);
	const driftX = $derived(Math.cos(driftRad));
	const driftY = $derived(Math.sin(driftRad) * 0.35);

	// Per-layer drift durations (closer = faster, far = slowest).
	// Stretched durations × ~5-8× from earlier values so the CSS loop period
	// exceeds typical viewing time — the 'repeat snap' the user noticed becomes
	// invisible in practice (nobody watches clouds for 5 minutes straight to
	// catch the wrap). Combined with baseFrequency animate on feTurbulence,
	// clouds morph continuously even when positions loop.
	const cirrusDuration = $derived(`${420 / Math.max(speed, 0.01)}s`);  // 7 min cycle
	const backDuration   = $derived(`${280 / Math.max(speed, 0.01)}s`);  // 4.5 min
	const midDuration    = $derived(`${95 / Math.max(speed, 0.01)}s`);   // ~1.5 min
	const frontDuration  = $derived(`${40 / Math.max(speed, 0.01)}s`);   // ~40s

	// Density thresholds
	const showCirrus = $derived(density > 0.05);
	const showBack   = $derived(density > 0.1);
	const showMid    = $derived(density > 0.3);
	const showFront  = $derived(density > 0.55);
	const layerOpacity = $derived(Math.min(1, density * 1.1));

	// Night + weather cloud tint via feColorMatrix.
	// Output channel bias: R, G, B offsets added after RGB inversion (-1 diagonal).
	// Storm/rain nights shift toward deep blue-gray; clear nights shift cool pale blue.
	const rOffset = $derived(
		nightFactor > 0.5
			? (weather === 'storm' ? 0.30 : weather === 'rain' ? 0.48 : weather === 'overcast' ? 0.58 : 0.68)
			: 0.98 * wx.darkR
	);
	const gOffset = $derived(
		nightFactor > 0.5
			? (weather === 'storm' ? 0.34 : weather === 'rain' ? 0.50 : weather === 'overcast' ? 0.60 : 0.72)
			: 0.95 * wx.darkG
	);
	const bOffset = $derived(
		nightFactor > 0.5
			? (weather === 'storm' ? 0.45 : weather === 'rain' ? 0.58 : weather === 'overcast' ? 0.70 : 0.82)
			: 0.92 * wx.darkB
	);
	const alphaOffset = $derived(nightFactor > 0.5 ? -0.15 : 0);

	// Build dynamic colorMatrix string. Inverts RGB (-1 diagonal) then adds
	// our tint offsets. Alpha passes through with optional dim at night.
	const colorMatrix = $derived(
		`-1 0 0 0 ${rOffset}  0 -1 0 0 ${gOffset}  0 0 -1 0 ${bOffset}  0 0 0 1 ${alphaOffset}`,
	);

	// ── Cloud phase — RAF-tracked slow seed for per-cloud random sway ───────
	// Each seed reads `cloudPhase + idx × π/N` → sin/cos → position/size
	// offsets. This gives every cloud an independent jitter cycle.
	// First-frame delta is suppressed by re-arming `last` after the first tick.
	let cloudPhase = $state(0);
	$effect(() => {
		let raf: number;
		let last = performance.now();
		let first = true;
		const loop = (now: number) => {
			if (first) { last = now; first = false; }
			else {
				cloudPhase += ((now - last) / 1000) * 0.05 * speed;
				last = now;
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	// Per-seed position jitter — deterministic sin waves off cloudPhase + idx.
	// phaseStep ensures each cloud (even at same position) has a unique sway cycle.
	function jitter(idx: number, base: number, amp: number, freq: number, phaseStep = 0): number {
		return base + Math.sin(cloudPhase * freq + idx * 1.91 + phaseStep) * amp;
	}

	// Cirrus wisps — very thin horizontal streaks at top of sky.
	// 4 wisps, 12% opacity, animate independently.
	const cirrusData = Array(4).fill(0).map((_, i) => ({
		top:  1 + i * 2.2,
		left: i * 28 + Math.sin(i * 2.3) * 5,
		width: 30 + i * 8,
	}));
</script>

<!-- Five seed variants per layer so sibling clouds get different shapes.
     Share the same filter chain template but vary feTurbulence `seed` +
     slight baseFrequency drift so no two clouds look identical.

     Weather morphology: all filter parameters scale with wx.* multipliers so
     storm = heavy dark lumps, clear = light crisp wisps. -->
<svg class="defs" aria-hidden="true">
	<defs>
		<!-- Cirrus wisps — ultra-thin, very high, minimal displacement -->
		{#each [2, 11, 23, 37] as seedNum, i}
			<filter id="cloud-cirrus-{i}" x="-100%" y="-100%" width="300%" height="300%">
				<feGaussianBlur in="SourceGraphic" stdDeviation={2 * wx.blurMul} result="pre" />
				<feTurbulence type="fractalNoise" baseFrequency={0.030 * wx.baseFreqMul + i * 0.004} numOctaves="2" seed={seedNum} result="noise">
					{#if animate}
						<animate attributeName="baseFrequency"
							dur="{(22 + i * 4) * wx.morphDurMul}s"
							values="{(0.022 + i * 0.004) * wx.baseFreqMul};{(0.038 + i * 0.004) * wx.baseFreqMul};{(0.028 + i * 0.004) * wx.baseFreqMul};{(0.022 + i * 0.004) * wx.baseFreqMul}"
							repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feDisplacementMap in="pre" in2="noise" scale={18 * wx.displaceMul} result="disp" />
				<feGaussianBlur in="disp" stdDeviation={1.5 * wx.blurMul} result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>
		{/each}

		{#each [1, 7, 13, 19, 31] as seedNum, i (seedNum)}
			<!-- Back / ceiling clouds — wider baseFrequency animation range so
			     shapes MORPH visibly over each cycle, not just subtly drift. -->
			<filter id="cloud-back-{i}" x="-25%" y="-25%" width="150%" height="150%">
				<feGaussianBlur in="SourceGraphic" stdDeviation={6 * wx.blurMul} result="pre" />
				<feTurbulence type="fractalNoise" baseFrequency={(0.010 + i * 0.002) * wx.baseFreqMul} numOctaves="3" seed={seedNum} result="noise">
					{#if animate}
						<animate attributeName="baseFrequency"
							dur="{(42 + i * 3) * wx.morphDurMul}s"
							values="{(0.008 + i * 0.002) * wx.baseFreqMul};{(0.018 + i * 0.002) * wx.baseFreqMul};{(0.012 + i * 0.002) * wx.baseFreqMul};{(0.008 + i * 0.002) * wx.baseFreqMul}"
							repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feDisplacementMap in="pre" in2="noise" scale={(65 + i * 5) * wx.displaceMul} result="disp" />
				<feGaussianBlur in="disp" stdDeviation={4 * wx.blurMul} result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>

			<filter id="cloud-mid-{i}" x="-25%" y="-25%" width="150%" height="150%">
				<feGaussianBlur in="SourceGraphic" stdDeviation={5 * wx.blurMul} result="pre" />
				<feTurbulence type="fractalNoise" baseFrequency={(0.014 + i * 0.002) * wx.baseFreqMul} numOctaves="2" seed={seedNum + 100} result="noise">
					{#if animate}
						<animate attributeName="baseFrequency"
							dur="{(28 + i * 2) * wx.morphDurMul}s"
							values="{(0.012 + i * 0.002) * wx.baseFreqMul};{(0.022 + i * 0.002) * wx.baseFreqMul};{(0.016 + i * 0.002) * wx.baseFreqMul};{(0.012 + i * 0.002) * wx.baseFreqMul}"
							repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feDisplacementMap in="pre" in2="noise" scale={(50 + i * 4) * wx.displaceMul} result="disp" />
				<feGaussianBlur in="disp" stdDeviation={3 * wx.blurMul} result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>

			<filter id="cloud-front-{i}" x="-25%" y="-25%" width="150%" height="150%">
				<feGaussianBlur in="SourceGraphic" stdDeviation={4 * wx.blurMul} result="pre" />
				<feTurbulence type="fractalNoise" baseFrequency={(0.017 + i * 0.002) * wx.baseFreqMul} numOctaves="2" seed={seedNum + 200} result="noise">
					{#if animate}
						<animate attributeName="baseFrequency"
							dur="{(18 + i) * wx.morphDurMul}s"
							values="{(0.015 + i * 0.002) * wx.baseFreqMul};{(0.027 + i * 0.002) * wx.baseFreqMul};{(0.019 + i * 0.002) * wx.baseFreqMul};{(0.015 + i * 0.002) * wx.baseFreqMul}"
							repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feDisplacementMap in="pre" in2="noise" scale={(40 + i * 3) * wx.displaceMul} result="disp" />
				<feGaussianBlur in="disp" stdDeviation={2.5 * wx.blurMul} result="soft" />
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
	<!--
	  Layer stack (top → bottom in viewport, back → front in z):
	    CIRRUS  (0-8%)   — ultra-thin high wisps, slowest drift
	    BACK    (0-28%)  — dense connected cloud ceiling, overlaps cirrus base
	    MID     (30-50%) — sparse wisps between ceiling and viewer
	    FRONT   (60-80%) — rare thin strands, fastest drift
	  Vertical drift (Y oscillation) is composited on top of the horizontal
	  drift via a separate animation-name so both run simultaneously.
	 -->

	{#if showCirrus}
		<!-- CIRRUS — thin streaks at the very top of the sky, nearly invisible
		     wisps that give height + depth to the cloud ceiling above. -->
		<div class="cloud-layer cirrus" style:animation-duration={cirrusDuration}>
			{#each cirrusData as c, i}
				<div class="seed cirrus-wisp"
					style:top="{c.top}%"
					style:left="{c.left}%"
					style:width="{c.width}%"
					style:--phase-drift="{i * 2.1}">
				</div>
			{/each}
		</div>
	{/if}

	{#if showBack}
		<!-- TOP CEILING: dense connected cloud mass at the top of frame -->
		<div class="cloud-layer back" style:animation-duration={backDuration}>
			<!-- Row 1 — very top, widest, most connected. phaseStep = 0 for row. -->
			{#each Array(9) as _, i}
				<div class="seed ceiling"
					style:top="{jitter(i, 2, 1, 0.4, 0)}%"
					style:left="{jitter(i, -3 + i * 13, 1.5, 0.2, 0.3)}%"></div>
			{/each}
			<!-- Row 2 — slightly lower, overlaps row 1 for connected look. phaseStep = π/4 -->
			{#each Array(8) as _, i}
				<div class="seed ceiling"
					style:top="{jitter(i + 9, 10, 1, 0.5, 0.8)}%"
					style:left="{jitter(i + 9, 5 + i * 13, 1.5, 0.2, 0.6)}%"></div>
			{/each}
			<!-- Row 3 — approaches horizon, slightly smaller. phaseStep = π/2 -->
			{#each Array(7) as _, i}
				<div class="seed ceiling-thin"
					style:top="{jitter(i + 17, 20, 1, 0.4, 1.2)}%"
					style:left="{jitter(i + 17, -2 + i * 15, 1.5, 0.2, 0.9)}%"></div>
			{/each}
		</div>
	{/if}
	{#if showMid}
		<!-- Mid wisps — 3 SMALL thin clouds between horizon and viewer.
		     Sparse because the ceiling above dominates the scene. phaseStep = π -->
		<div class="cloud-layer mid" style:animation-duration={midDuration}>
			<div class="seed wisp" style:top="{jitter(30, 35, 1.5, 0.3, 1.4)}%" style:left="{jitter(30, 18, 4, 0.2, 1.1)}%"></div>
			<div class="seed wisp" style:top="{jitter(31, 40, 1.5, 0.35, 1.6)}%" style:left="{jitter(31, 55, 4, 0.2, 1.3)}%"></div>
			<div class="seed wisp" style:top="{jitter(32, 44, 1.5, 0.3, 1.8)}%" style:left="{jitter(32, 82, 4, 0.2, 1.5)}%"></div>
		</div>
	{/if}
	{#if showFront}
		<!-- FOREGROUND — rare thin strand drifting fast through lower frame.
		     PhaseStep = 2π so these are maximally desynchronized from others. -->
		<div class="cloud-layer front" style:animation-duration={frontDuration}>
			<div class="seed near-wisp" style:top="{jitter(40, 62, 2, 0.25, 3.1)}%" style:left="{jitter(40, 30, 5, 0.15, 2.5)}%"></div>
			<div class="seed near-wisp" style:top="{jitter(41, 70, 2, 0.2, 3.3)}%"  style:left="{jitter(41, 75, 5, 0.12, 2.8)}%"></div>
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

	/* Dense CEILING at top (far), sparse WISP/near-wisp near (close).
	   - ceiling:      wide + overlapping for connected mass, opaque
	   - ceiling-thin: same width but thinner aspect for third row
	   - wisp:         thin elongated strands between ceiling and viewer
	   - near-wisp:    closer thin wisps, slightly taller */
	/* Ceiling (far/top): smaller height (taller aspect), more opaque, packed
	   dense at top. Drift slowest (handled via .cloud-layer.back duration). */
	.seed.ceiling       { width: 12%; aspect-ratio: 3 / 1;   opacity: 0.85; }
	.seed.ceiling-thin  { width: 11%; aspect-ratio: 4 / 1;   opacity: 0.75; }
	.seed.wisp          { width: 10%; aspect-ratio: 4 / 1;   opacity: 0.5; }
	.seed.near-wisp     { width: 14%; aspect-ratio: 3.2 / 1; opacity: 0.6; }
	.seed.cirrus-wisp   { width: 32%; aspect-ratio: 8 / 1;   opacity: 0.22; filter: url(#cloud-cirrus-0); animation-name: cirrus-drift; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }

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

	/* Cirrus filter cycling — 4 wisps, 4 filter variants */
	.cloud-layer.cirrus .seed:nth-of-type(4n+1) { filter: url(#cloud-cirrus-0); animation-delay: calc(var(--phase-drift) * -0.5s); }
	.cloud-layer.cirrus .seed:nth-of-type(4n+2) { filter: url(#cloud-cirrus-1); animation-delay: calc(var(--phase-drift) * -1.1s); }
	.cloud-layer.cirrus .seed:nth-of-type(4n+3) { filter: url(#cloud-cirrus-2); animation-delay: calc(var(--phase-drift) * -0.7s); }
	.cloud-layer.cirrus .seed:nth-of-type(4n)   { filter: url(#cloud-cirrus-3); animation-delay: calc(var(--phase-drift) * -1.4s); }

	/* Drift: horizontal X + vertical Y oscillation run as separate animations
	   on the same element so clouds both stream AND breathe vertically.
	   Cirrus: very slow horizontal drift + gentle vertical bob.
	   Back/mid/front: standard horizontal drift + subtle Y oscillation. */
	/* Added translateZ oscillation so clouds breathe through the depth axis
	   in addition to horizontal drift. Combined with perspective:1200px this
	   makes clouds subtly 'come closer / recede' as they pass. */
	@keyframes cloud-drift {
		from { transform: translate3d(calc(var(--drift-x) * -60%), calc(var(--drift-y) * -30% + var(--drift-y-osc, 0px)), 0px); }
		50%  { transform: translate3d(0%, calc(var(--drift-y-osc, 0px)), -40px); }
		to   { transform: translate3d(calc(var(--drift-x) * 60%),  calc(var(--drift-y) * 30%  + var(--drift-y-osc, 0px)), 0px); }
	}

	/* Per-cloud animation-delay — each cloud starts at a different phase of
	   the drift cycle so they don't ALL reset at the same moment (breaks
	   the 'loop' feel user reported). Negative delays start mid-cycle. */
	.cloud-layer .seed:nth-of-type(7n+1) { animation-delay: -3s, -1.2s; }
	.cloud-layer .seed:nth-of-type(7n+2) { animation-delay: -9s, -4.3s; }
	.cloud-layer .seed:nth-of-type(7n+3) { animation-delay: -15s, -6.7s; }
	.cloud-layer .seed:nth-of-type(7n+4) { animation-delay: -21s, -2.8s; }
	.cloud-layer .seed:nth-of-type(7n+5) { animation-delay: -27s, -5.9s; }
	.cloud-layer .seed:nth-of-type(7n+6) { animation-delay: -33s, -3.6s; }
	.cloud-layer .seed:nth-of-type(7n+7) { animation-delay: -39s, -7.2s; }

	@keyframes cloud-drift-y {
		from { --drift-y-osc: -4px; }
		to   { --drift-y-osc:  4px; }
	}

	@keyframes cirrus-drift {
		from { transform: translate(calc(var(--drift-x) * -40%), 0px) scaleY(1); }
		50%  { transform: translate(calc(var(--drift-x) * -20%), -3px) scaleY(1.08); }
		to   { transform: translate(calc(var(--drift-x) * 40%),  0px) scaleY(1); }
	}

	.cloud-layer.back, .cloud-layer.mid, .cloud-layer.front {
		animation: cloud-drift, cloud-drift-y 8s ease-in-out infinite;
		/* animation-delay set per-element via :nth-of-type above — each
		   cloud starts at a different drift-cycle phase */
	}

	@media (prefers-reduced-motion: reduce) {
		.cloud-layer { animation: none; }
	}
</style>
