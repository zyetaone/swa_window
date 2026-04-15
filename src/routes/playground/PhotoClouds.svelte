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
	{#if showBack}
		<!-- Distant cloud carpet — DENSE band of tiny clouds near horizon.
		     Stagger rows slightly so the carpet doesn't read as a line. -->
		<div class="cloud-layer back" style:animation-duration={backDuration}>
			<!-- Row 1 — very top (far-far distance, atmospheric haze) -->
			<div class="seed tiny" style:top="2%"  style:left="3%"></div>
			<div class="seed tiny" style:top="4%"  style:left="12%"></div>
			<div class="seed tiny" style:top="2%"  style:left="20%"></div>
			<div class="seed tiny" style:top="3%"  style:left="29%"></div>
			<div class="seed tiny" style:top="5%"  style:left="37%"></div>
			<div class="seed tiny" style:top="2%"  style:left="46%"></div>
			<div class="seed tiny" style:top="4%"  style:left="55%"></div>
			<div class="seed tiny" style:top="3%"  style:left="64%"></div>
			<div class="seed tiny" style:top="5%"  style:left="73%"></div>
			<div class="seed tiny" style:top="2%"  style:left="82%"></div>
			<div class="seed tiny" style:top="4%"  style:left="91%"></div>
			<!-- Row 2 — slightly closer (still far) -->
			<div class="seed small" style:top="8%"  style:left="8%"></div>
			<div class="seed small" style:top="10%" style:left="22%"></div>
			<div class="seed small" style:top="9%"  style:left="36%"></div>
			<div class="seed small" style:top="11%" style:left="50%"></div>
			<div class="seed small" style:top="9%"  style:left="63%"></div>
			<div class="seed small" style:top="10%" style:left="77%"></div>
			<div class="seed small" style:top="8%"  style:left="88%"></div>
		</div>
	{/if}
	{#if showMid}
		<!-- Middle distance — moderate count, medium size -->
		<div class="cloud-layer mid" style:animation-duration={midDuration}>
			<div class="seed" style:top="20%" style:left="18%"></div>
			<div class="seed" style:top="22%" style:left="62%"></div>
		</div>
	{/if}
	{#if showFront}
		<!-- Foreground — rare, large, wispy -->
		<div class="cloud-layer front" style:animation-duration={frontDuration}>
			<div class="seed large" style:top="32%" style:left="38%"></div>
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

	/* Size variants — tiny/small on horizon (distance), large close-up */
	.seed.tiny  { width: 9%;  aspect-ratio: 2.2 / 1; opacity: 0.72; }
	.seed.small { width: 13%; aspect-ratio: 2.1 / 1; opacity: 0.82; }
	.seed.large { width: 26%; aspect-ratio: 2.5 / 1; opacity: 0.95; }

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
