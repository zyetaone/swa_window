<script lang="ts">
	/**
	 * PhotoClouds — Yannakopoulos SVG-cloud technique adapted to the playground.
	 *
	 * Core trick: a DARK ellipse is the "seed" shape. feTurbulence +
	 * feDisplacementMap warp its edges into organic cloud silhouettes.
	 * The VISIBLE cloud is the big white box-shadow offset from the dark
	 * source — we never see the black ellipse itself (positioned offscreen).
	 *
	 * Ref: https://css-tricks.com/drawing-realistic-clouds-with-svg-and-css/
	 *
	 * Three parallax depth layers (back/mid/front), each with its own filter
	 * at a different displacement scale for depth variety. Drift speed varies
	 * per layer so closer clouds move faster (parallax).
	 *
	 * Wind angle and heading drive the drift direction reactively.
	 * Density maps to opacity + per-layer visibility.
	 * nightFactor darkens + cools the box-shadow color for moonlit clouds.
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

	// Wind vector — clouds drift opposite to plane heading, modulated by wind.
	const driftAngle = $derived((heading + windAngle + 180) % 360);
	const driftRad = $derived((driftAngle * Math.PI) / 180);

	// Cloud "sun" color — warm cream by day, cool pale blue by night. This
	// becomes the box-shadow color (the actual visible cloud tint).
	const cloudColor = $derived.by(() => {
		if (nightFactor > 0.5) {
			const r = Math.round(160 - nightFactor * 20);
			const g = Math.round(170 - nightFactor * 15);
			const b = Math.round(200 + nightFactor * 10);
			return `rgba(${r}, ${g}, ${b}, ${0.85 - nightFactor * 0.25})`;
		}
		return `rgba(${245 + 5}, ${240 + 5}, ${235 + 8}, 0.92)`;
	});

	// Per-layer drift — closer layers (front) move faster for parallax.
	// Drift expressed as a CSS animation duration; lower = faster.
	const backDuration = $derived(`${80 / Math.max(speed, 0.01)}s`);
	const midDuration  = $derived(`${50 / Math.max(speed, 0.01)}s`);
	const frontDuration = $derived(`${30 / Math.max(speed, 0.01)}s`);

	// Density thresholds — thinner skies drop farther layers
	const showBack = $derived(density > 0.15);
	const showMid   = $derived(density > 0.3);
	const showFront = $derived(density > 0.5);
	const layerOpacity = $derived(Math.min(1, density * 1.2));

	// Transform for cloud-layer motion. Drift vector → CSS translate.
	const driftX = $derived(Math.cos(driftRad));
	const driftY = $derived(Math.sin(driftRad) * 0.4);  // flatten vertical
</script>

<!-- Hidden SVG defs. Zero-size so it adds no layout. -->
<svg class="defs" aria-hidden="true">
	<defs>
		<filter id="cloud-back" x="-50%" y="-50%" width="200%" height="200%">
			<feTurbulence type="fractalNoise" baseFrequency="0.010" numOctaves="3" seed="1">
				{#if animate}
					<animate attributeName="baseFrequency" dur="44s"
						values="0.010;0.014;0.010" repeatCount="indefinite" />
				{/if}
			</feTurbulence>
			<feDisplacementMap in="SourceGraphic" scale="170" />
		</filter>

		<filter id="cloud-mid" x="-50%" y="-50%" width="200%" height="200%">
			<feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2" seed="2">
				{#if animate}
					<animate attributeName="baseFrequency" dur="28s"
						values="0.014;0.018;0.014" repeatCount="indefinite" />
				{/if}
			</feTurbulence>
			<feDisplacementMap in="SourceGraphic" scale="140" />
		</filter>

		<filter id="cloud-front" x="-50%" y="-50%" width="200%" height="200%">
			<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="3">
				{#if animate}
					<animate attributeName="baseFrequency" dur="18s"
						values="0.018;0.022;0.018" repeatCount="indefinite" />
				{/if}
			</feTurbulence>
			<feDisplacementMap in="SourceGraphic" scale="110" />
		</filter>
	</defs>
</svg>

<div
	class="photo-clouds"
	style:opacity={layerOpacity}
	style:--cloud-color={cloudColor}
	style:--drift-x={driftX}
	style:--drift-y={driftY}
	aria-hidden="true"
>
	{#if showBack}
		<div class="cloud-layer back" style:animation-duration={backDuration}>
			<div class="seed" style:filter="url(#cloud-back)"></div>
			<div class="seed" style:filter="url(#cloud-back)" style:--offset="35%"></div>
		</div>
	{/if}
	{#if showMid}
		<div class="cloud-layer mid" style:animation-duration={midDuration}>
			<div class="seed" style:filter="url(#cloud-mid)" style:--offset="12%"></div>
			<div class="seed" style:filter="url(#cloud-mid)" style:--offset="60%"></div>
		</div>
	{/if}
	{#if showFront}
		<div class="cloud-layer front" style:animation-duration={frontDuration}>
			<div class="seed" style:filter="url(#cloud-front)" style:--offset="28%"></div>
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
		inset: -10% -30%;  /* oversize so drifting doesn't expose edges */
		animation-name: cloud-drift;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
	}

	/* Each `.seed` = dark ellipse + filter. Visible cloud = offset box-shadow. */
	.seed {
		position: absolute;
		top: var(--offset, 0%);
		left: -35%;
		width: 60%;
		height: 50%;
		background: #000;
		border-radius: 50%;
		/* The box-shadow IS the visible cloud. Huge spread + offset so the
		   dark seed stays offscreen while its distorted halo paints clouds. */
		box-shadow:
			60vw 45vh 80px 20px var(--cloud-color, rgba(245, 240, 235, 0.9)),
			55vw 25vh 70px 10px var(--cloud-color, rgba(245, 240, 235, 0.8));
		filter: url(#cloud-back);
	}

	.cloud-layer.back .seed {
		transform: scale(0.7);
		opacity: 0.85;
	}
	.cloud-layer.mid .seed {
		transform: scale(0.9);
		opacity: 0.92;
	}
	.cloud-layer.front .seed {
		transform: scale(1.15);
		opacity: 0.95;
	}

	@keyframes cloud-drift {
		from { transform: translate(0, 0); }
		to   { transform: translate(calc(var(--drift-x) * 100%), calc(var(--drift-y) * 100%)); }
	}

	@media (prefers-reduced-motion: reduce) {
		.cloud-layer { animation: none; }
	}
</style>
