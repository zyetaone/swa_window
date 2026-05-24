<script lang="ts">
	/**
	 * /playground/three — full Three.js + Threlte artistic lab.
	 *
	 * Counterpart to /playground (the Cesium scene lab). Same model context
	 * (useAeroWindow) drives both — flight, time-of-day, weather, location,
	 * autopilot all behave identically. The only thing that differs is the
	 * RENDERER: this route mounts a stylized Three.js sphere via Threlte
	 * instead of Cesium's photoreal globe.
	 *
	 * Architectural intent: a sandbox for shader-driven composition that
	 * Cesium's fixed pipeline can't accommodate. Volumetric clouds,
	 * Bruneton scattering, custom blend modes — all queued for the days
	 * ahead. Day-1 ships a stylized procedural earth + sun-driven
	 * day/night + atmosphere rim, hooked into the existing model + drawer.
	 *
	 * Not a ship route — /playground/three is an art lab. If a technique
	 * here proves out, port the CONCEPT to /lib/world/ (Cesium) for the
	 * production install. Keeping both stacks clean is the explicit goal.
	 */
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import ThreeViewer from '$lib/world-three/ThreeViewer.svelte';
	import LabShell from '$lib/playground/LabShell.svelte';

	const model = createAeroWindow();

	// Sync the flight engine to the show's opening location. createAeroWindow
	// writes model.location='hyderabad' directly (no side-effect by design),
	// but FlightSimEngine's lat/lon stay at their field-initialised default
	// (Dubai). Without this line the camera would sit over Dubai while the
	// OsmBuildings render at Hyderabad — 1500 km apart. Calling setLocation
	// snaps flight.lat/lon (and the smoothed cam* values via #tickSmoothing)
	// to the actual show city.
	model.setLocation(model.location);

	let cityMode = $state(false);
	let debugState = $state({
		frame: 0, drawCalls: 0, triangles: 0, sceneChildren: 0,
		cameraPos: [0, 0, 0] as [number, number, number],
		cameraDist: 0,
		rendererSize: [0, 0] as [number, number],
	});

	// City-mode lock — pins altitude at 500 ft and keeps the flight engine's
	// altitude lerp suppressed by re-triggering the user-interaction override
	// (8 s window) every 6 s while active. Toggle resumes normal autopilot.
	$effect(() => {
		if (!cityMode) return;
		model.flight.altitude = 500;
		model.onUserInteraction('altitude');
		const i = setInterval(() => {
			model.flight.altitude = 500;
			model.onUserInteraction('altitude');
		}, 6000);
		return () => clearInterval(i);
	});
</script>

<LabShell 
	title="Three.js Lab" 
	hint="Threlte composite · stylized renderer for R&D"
	{model}
	showCityMode
	bind:cityMode
	onCityToggle={() => { cityMode = !cityMode; }}
>
	{#snippet viewer()}
		<ThreeViewer bind:debugState />
	{/snippet}

	{#snippet diag()}
		<!-- Diagnostic HUD — visible at all times so even if the 3D scene
		     fails to render, the user can confirm the scaffolding is alive. -->
		<aside class="diag">
			<div><b>Three.js Lab</b></div>
			<div>frame: <code>{debugState.frame}</code> · calls: <code>{debugState.drawCalls}</code> · tris: <code>{debugState.triangles.toLocaleString()}</code></div>
			<div>scene children: <code>{debugState.sceneChildren}</code> · renderer: <code>{debugState.rendererSize[0]}×{debugState.rendererSize[1]}</code></div>
			<div>cam dist from origin: <code>{(debugState.cameraDist / 1000).toFixed(0)} km</code></div>
			<div>flight: <code>{model.flight.camLat.toFixed(2)}°N, {model.flight.camLon.toFixed(2)}°E, {(model.flight.camAlt / 1000).toFixed(2)}k ft</code></div>
			<div>nightFactor: <code>{model.nightFactor.toFixed(2)}</code> · weather: <code>{model.weather}</code></div>
		</aside>
	{/snippet}

	{#snippet extraControls()}
		<fieldset>
			<legend>Night intensity</legend>
			<label>
				<span class="val">{(model.config.world.nightLightIntensity * 100).toFixed(0)}%</span>
				<input
					type="range"
					bind:value={model.config.world.nightLightIntensity}
					min="0"
					max="3"
					step="0.05"
				/>
			</label>
		</fieldset>
	{/snippet}
</LabShell>

<style>
	/* All .playground / drawer / chip-row / fieldset / .diag / .city-btn styles
	   now live in LabShell (single source of truth for both lean labs). */
</style>
