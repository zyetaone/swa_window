<script lang="ts">
	/**
	 * Playground — live sandbox for rendering experiments.
	 *
	 * Isolated from the main window so we can tweak cloud logic,
	 * test perspective transforms, and wire plane-movement-to-clouds
	 * without breaking the production display route.
	 *
	 * Sliders control everything. No WindowModel — raw values only.
	 */

	import type { SkyState } from '$lib/shared/types';
	import CloudBlobs from '$lib/components/CloudBlobs.svelte';

	// Simulation state — all controlled by sliders
	let density = $state(0.6);
	let speed = $state(1.0);
	let skyState = $state<SkyState>('day');
	let time = $state(0);

	// Plane movement — these will drive cloud parallax
	let heading = $state(90);     // degrees, 0=N, 90=E
	let planeSpeed = $state(1.0); // multiplier
	let altitude = $state(30000); // feet
	let windAngle = $state(88);   // degrees, matches WEATHER_EFFECTS.clear.windAngle

	// Tick: advance time continuously
	let raf: number;
	$effect(() => {
		let last = performance.now();
		function loop(now: number) {
			const dt = (now - last) / 1000;
			last = now;
			time += dt * planeSpeed;
			raf = requestAnimationFrame(loop);
		}
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	// Sky presets
	const skyOptions: SkyState[] = ['day', 'dawn', 'dusk', 'night'];

	// Background gradient based on sky state
	const bgGradient = $derived.by(() => {
		switch (skyState) {
			case 'night': return 'linear-gradient(180deg, #0a0a1a 0%, #1a1a2e 50%, #0d0d0d 100%)';
			case 'dawn': return 'linear-gradient(180deg, #2d1b4e 0%, #e07050 40%, #dda060 60%, #3d5a3d 100%)';
			case 'dusk': return 'linear-gradient(180deg, #1a1a3e 0%, #c06040 35%, #ddaa70 55%, #2d3d2d 100%)';
			default: return 'linear-gradient(180deg, #4488cc 0%, #88bbee 30%, #aaddff 50%, #667744 70%, #556633 100%)';
		}
	});
</script>

<div class="playground">
	<div class="viewport" style:background={bgGradient}>
		<CloudBlobs
			{density}
			{speed}
			{skyState}
			{time}
			{heading}
			{altitude}
			{windAngle}
		/>
		<div class="horizon-line"></div>
		<div class="hud">
			<span>HDG {heading.toFixed(0)}</span>
			<span>ALT {(altitude / 1000).toFixed(0)}k</span>
			<span>SPD {planeSpeed.toFixed(1)}x</span>
			<span>T {time.toFixed(0)}s</span>
			<span>{skyState.toUpperCase()}</span>
		</div>
	</div>

	<div class="controls">
		<h2>Cloud Playground</h2>
		<p class="hint">Tweak values live. Clouds respond instantly via HMR.</p>

		<fieldset>
			<legend>Clouds</legend>
			<label>
				Density: {(density * 100).toFixed(0)}%
				<input type="range" bind:value={density} min="0" max="1" step="0.01" />
			</label>
			<label>
				Drift Speed: {speed.toFixed(1)}x
				<input type="range" bind:value={speed} min="0.1" max="3" step="0.1" />
			</label>
		</fieldset>

		<fieldset>
			<legend>Plane</legend>
			<label>
				Heading: {heading.toFixed(0)} deg
				<input type="range" bind:value={heading} min="0" max="360" step="1" />
			</label>
			<label>
				Speed: {planeSpeed.toFixed(1)}x
				<input type="range" bind:value={planeSpeed} min="0.1" max="5" step="0.1" />
			</label>
			<label>
				Altitude: {(altitude / 1000).toFixed(0)}k ft
				<input type="range" bind:value={altitude} min="5000" max="45000" step="1000" />
			</label>
		</fieldset>

		<fieldset>
			<legend>Wind</legend>
			<label>
				Wind Angle: {windAngle.toFixed(0)} deg
				<input type="range" bind:value={windAngle} min="60" max="120" step="1" />
			</label>
		</fieldset>

		<fieldset>
			<legend>Sky</legend>
			<div class="sky-buttons">
				{#each skyOptions as opt (opt)}
					<button
						class:active={skyState === opt}
						onclick={() => skyState = opt}
					>{opt}</button>
				{/each}
			</div>
		</fieldset>
	</div>
</div>

<style>
	.playground {
		display: grid;
		grid-template-columns: 1fr 320px;
		height: 100vh;
		background: #111;
		color: #eee;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.viewport {
		position: relative;
		overflow: hidden;
		border-right: 1px solid #333;
	}

	.horizon-line {
		position: absolute;
		top: 45%;
		left: 0;
		right: 0;
		height: 1px;
		background: rgba(255, 255, 255, 0.15);
		pointer-events: none;
	}

	.hud {
		position: absolute;
		top: 12px;
		right: 12px;
		display: flex;
		gap: 16px;
		font: 11px/1 monospace;
		color: rgba(255, 255, 255, 0.5);
		pointer-events: none;
	}

	.controls {
		padding: 20px;
		overflow-y: auto;
		background: #1a1a1a;
	}

	.controls h2 {
		margin: 0 0 4px;
		font-size: 18px;
		font-weight: 600;
	}

	.hint {
		margin: 0 0 20px;
		font-size: 12px;
		color: #666;
	}

	fieldset {
		border: 1px solid #333;
		border-radius: 8px;
		padding: 12px;
		margin: 0 0 16px;
	}

	legend {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #888;
		padding: 0 6px;
	}

	label {
		display: block;
		font-size: 13px;
		margin-bottom: 10px;
		color: #ccc;
	}

	input[type="range"] {
		display: block;
		width: 100%;
		margin-top: 4px;
		accent-color: #4488cc;
	}

	.sky-buttons {
		display: flex;
		gap: 8px;
	}

	.sky-buttons button {
		flex: 1;
		padding: 8px;
		background: #2a2a2a;
		border: 1px solid #444;
		border-radius: 6px;
		color: #ccc;
		font-size: 12px;
		text-transform: capitalize;
		cursor: pointer;
		transition: all 0.15s;
	}

	.sky-buttons button:hover {
		background: #333;
	}

	.sky-buttons button.active {
		background: #335577;
		border-color: #4488cc;
		color: #fff;
	}
</style>
