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

<!-- Hidden SVG defs — zero-size container. -->
<svg class="defs" aria-hidden="true">
	<defs>
		<filter id="cloud-back" x="0%" y="0%" width="100%" height="100%">
			<feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="3" seed="1" result="noise">
				{#if animate}
					<animate attributeName="baseFrequency" dur="48s"
						values="0.012;0.016;0.012" repeatCount="indefinite" />
				{/if}
			</feTurbulence>
			<feDisplacementMap in="SourceGraphic" in2="noise" scale="130" result="disp" />
			<feGaussianBlur in="disp" stdDeviation="2" result="soft" />
			<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
		</filter>

		<filter id="cloud-mid" x="0%" y="0%" width="100%" height="100%">
			<feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="2" seed="2" result="noise">
				{#if animate}
					<animate attributeName="baseFrequency" dur="32s"
						values="0.016;0.020;0.016" repeatCount="indefinite" />
				{/if}
			</feTurbulence>
			<feDisplacementMap in="SourceGraphic" in2="noise" scale="100" result="disp" />
			<feGaussianBlur in="disp" stdDeviation="1.5" result="soft" />
			<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
		</filter>

		<filter id="cloud-front" x="0%" y="0%" width="100%" height="100%">
			<feTurbulence type="fractalNoise" baseFrequency="0.020" numOctaves="2" seed="3" result="noise">
				{#if animate}
					<animate attributeName="baseFrequency" dur="20s"
						values="0.020;0.025;0.020" repeatCount="indefinite" />
				{/if}
			</feTurbulence>
			<feDisplacementMap in="SourceGraphic" in2="noise" scale="80" result="disp" />
			<feGaussianBlur in="disp" stdDeviation="1.2" result="soft" />
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
	{#if showBack}
		<div class="cloud-layer back" style:animation-duration={backDuration}>
			<div class="seed" style:top="18%" style:left="10%"></div>
			<div class="seed" style:top="12%" style:left="55%"></div>
		</div>
	{/if}
	{#if showMid}
		<div class="cloud-layer mid" style:animation-duration={midDuration}>
			<div class="seed" style:top="8%" style:left="28%"></div>
			<div class="seed" style:top="25%" style:left="72%"></div>
		</div>
	{/if}
	{#if showFront}
		<div class="cloud-layer front" style:animation-duration={frontDuration}>
			<div class="seed" style:top="14%" style:left="42%"></div>
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
		width: 22%;       /* smaller clouds — was 60% */
		aspect-ratio: 2 / 1;
		background: #000;
		border-radius: 50%;
		opacity: 0.9;
	}

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
