<script lang="ts">
	/**
	 * /playground — lean Cesium scene lab.
	 *
	 * Cesium handles sky, ocean post-process (native waterMask + normals),
	 * terrain color-by-mood, and night lights. Everything else (clouds,
	 * weather, haze, micro-events) mounts via the shared scene Compositor.
	 * No shell widgets — no blind, no fleet sync, no corridor, no window
	 * frame. Just the composite, so we can tune visuals in isolation.
	 *
	 * Production `/` uses the exact same CesiumViewer + Compositor; the
	 * only difference is `/` adds the installation shell on top.
	 */
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import { WEATHER_EFFECTS } from '$content/weather';
	import { clamp } from '$lib/utils';
	import CesiumViewer from '$lib/world/CesiumViewer.svelte';
	import Compositor from '$lib/scene/compositor.svelte';
	import Weather from '$lib/shell/window/Weather.svelte';
	import LabShell from '$lib/playground/LabShell.svelte';

	const model = createAeroWindow();

	// RAF tick — model.tick drives the full simulation (flight, motion, director).
	// untrack() per invariant #3 (mirrors Pane.svelte): keeps 60 Hz config reads
	// inside model.tick from building a reactive dep back onto the model.
	import { untrack } from 'svelte';
	import { subscribe } from '$lib/game-loop';
	$effect(() => subscribe((dt) => untrack(() => model.tick(dt))));

	// Weather derivations (same shape as production /).
	const weatherFx = $derived(WEATHER_EFFECTS[model.weather]);
	const frostAmount = $derived(clamp((model.flight.altitude - 25000) / 15000, 0, 1));
</script>

<LabShell title="Scene Lab" hint="Cesium composite · tune visuals here, ship from /" {model}>
	{#snippet viewer()}
		<CesiumViewer />
		<Compositor />
		<Weather rainOpacity={weatherFx.rainOpacity} windAngle={weatherFx.windAngle} {frostAmount} />
	{/snippet}

	{#snippet extraControls()}
		<fieldset>
			<legend>Clouds</legend>
			<label>
				Density <span class="val">{(model.config.atmosphere.clouds.density * 100).toFixed(0)}%</span>
				<input
					type="range"
					bind:value={model.config.atmosphere.clouds.density}
					min="0"
					max="1"
					step="0.01"
				/>
			</label>
			<label>
				Drift speed <span class="val">{model.config.atmosphere.clouds.speed.toFixed(1)}×</span>
				<input
					type="range"
					bind:value={model.config.atmosphere.clouds.speed}
					min="0.1"
					max="3"
					step="0.1"
				/>
			</label>
		</fieldset>
	{/snippet}
</LabShell>

<style>
	/* All .playground / drawer / chip-row / fieldset styles now live in LabShell (single source). */
</style>
