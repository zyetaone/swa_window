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
	import { onDestroy } from 'svelte';
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import { LOCATIONS } from '$lib/locations';
	import { WEATHER_TYPES, type LocationId, type WeatherType } from '$lib/types';
	import { WEATHER_EFFECTS } from '$lib/constants';
	import { clamp, formatTime } from '$lib/utils';
	import CesiumViewer from '$lib/world/CesiumViewer.svelte';
	import Compositor from '$lib/scene/compositor.svelte';
	import Weather from '$lib/atmosphere/weather/Weather.svelte';

	const model = createAeroWindow();

	let drawerOpen = $state(false);

	// RAF tick — model.tick drives the full simulation (flight, motion, director).
	import { subscribe } from '$lib/game-loop';
	$effect(() => subscribe((dt) => { model.tick(dt); model.reportFrame(); }));

	// Weather derivations (same shape as production /).
	const weatherFx = $derived(WEATHER_EFFECTS[model.weather]);
	const frostAmount = $derived(clamp((model.flight.altitude - 25000) / 15000, 0, 1));

	onDestroy(() => {
		// Model cleanup handled by createAeroWindow lifecycle.
	});
</script>

<div class="playground">
	<div class="globe-pane">
		<CesiumViewer />
		<Compositor />
		<Weather rainOpacity={weatherFx.rainOpacity} windAngle={weatherFx.windAngle} {frostAmount} />
	</div>

	<button
		class="drawer-toggle"
		class:open={drawerOpen}
		onclick={() => (drawerOpen = !drawerOpen)}
		aria-label="Toggle settings"
	>
		{drawerOpen ? '✕' : '⚙'}
	</button>

	<aside class="drawer" class:open={drawerOpen} aria-hidden={!drawerOpen}>
		<header>
			<h2>Scene Lab</h2>
			<p class="hint">Cesium composite · tune visuals here, ship from /</p>
		</header>

		<fieldset>
			<legend>Location</legend>
			<select
				class="select"
				value={model.location}
				onchange={(e) => model.applyScene((e.currentTarget as HTMLSelectElement).value as LocationId)}
			>
				{#each LOCATIONS as loc (loc.id)}
					<option value={loc.id}>{loc.name}</option>
				{/each}
			</select>
		</fieldset>

		<fieldset>
			<legend>Time of day</legend>
			<label>
				{formatTime(model.timeOfDay)}
				<input type="range" bind:value={model.timeOfDay} min="0" max="24" step="0.1" />
			</label>
		</fieldset>

		<fieldset>
			<legend>Weather</legend>
			<div class="chip-row">
				{#each WEATHER_TYPES as w (w)}
					<button
						type="button"
						class:active={model.weather === w}
						onclick={() => (model.weather = w as WeatherType)}
					>
						{w}
					</button>
				{/each}
			</div>
		</fieldset>

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
	</aside>
</div>

<style>
	.playground {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #04060d;
		color: #eee;
		font-family: system-ui, sans-serif;
	}
	.globe-pane { position: absolute; inset: 0; }

	.drawer-toggle {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 30;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: rgba(10, 10, 15, 0.8);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #eee;
		font-size: 16px;
		cursor: pointer;
	}
	.drawer-toggle.open { background: rgba(30, 30, 40, 0.9); }

	.drawer {
		position: absolute;
		top: 0; right: 0; bottom: 0;
		width: 320px;
		background: rgba(10, 10, 15, 0.94);
		border-left: 1px solid rgba(255, 255, 255, 0.12);
		padding: 64px 16px 16px;
		overflow-y: auto;
		transform: translateX(100%);
		transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
		z-index: 25;
	}
	.drawer.open { transform: translateX(0); }

	.drawer header h2 { font-size: 16px; margin: 0 0 4px; color: #fff; }
	.drawer header .hint { margin: 0 0 16px; font-size: 11px; color: #888; }

	fieldset {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 12px;
		margin: 0 0 16px;
		padding: 12px;
	}
	fieldset legend {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #666;
		padding: 0 8px;
	}
	label { display: block; font-size: 12px; color: #ccc; margin: 8px 0; }
	label .val { float: right; color: #7faeff; font-family: ui-monospace, monospace; font-size: 11px; }

	.select,
	select {
		width: 100%;
		background: rgba(0, 0, 0, 0.3);
		color: #eee;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		padding: 6px 8px;
		font-size: 12px;
	}

	.chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
	.chip-row button {
		padding: 4px 10px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		color: #aaa;
		font-size: 11px;
		cursor: pointer;
	}
	.chip-row button.active {
		background: rgba(127, 174, 255, 0.2);
		border-color: rgba(127, 174, 255, 0.5);
		color: #fff;
	}

	input[type='range'] { width: 100%; margin: 8px 0; }
</style>
