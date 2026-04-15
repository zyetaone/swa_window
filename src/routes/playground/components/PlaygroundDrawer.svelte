<script lang="ts">
	import { LOCATIONS } from '$lib/locations';
	import { WEATHER_TYPES } from '$lib/types';
	import { formatTime } from '$lib/utils';
	import { MAPLIBRE_SOURCES, CACHED_SOURCES } from '../imagery';
	import { pg } from '../lib/playground-state.svelte';
	import { getSkyState } from '$lib/utils';

	let { drawerOpen = $bindable(false) } : { drawerOpen?: boolean } = $props();

	const skyState = $derived(getSkyState(pg.timeOfDay));
</script>

<!-- Settings drawer — slides in from right -->
<aside class="drawer" class:open={drawerOpen} aria-hidden={!drawerOpen}>
	<header>
		<h2>Scene Lab</h2>
		<p class="hint">MapLibre globe + atmosphere + terrain + buildings. GeoJSON-driven styling.</p>
	</header>

	<fieldset>
		<legend>Location</legend>
		<select class="select" bind:value={pg.activeLocation}>
			{#each LOCATIONS as loc (loc.id)}
				<option value={loc.id}>{loc.name}</option>
			{/each}
		</select>
	</fieldset>

	<fieldset>
		<legend>Time of day</legend>
		<label>{formatTime(pg.timeOfDay)} <span class="val sky-{skyState}">{skyState}</span>
			<input type="range" bind:value={pg.timeOfDay} min="0" max="24" step="0.1" disabled={pg.autoTime} />
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={pg.autoTime} />
			Auto-advance (48s = full day)
		</label>
	</fieldset>

	<fieldset>
		<legend>Weather</legend>
		<div class="chip-row weather-chips">
			{#each WEATHER_TYPES as w (w)}
				<button type="button" class={[pg.weather === w && 'active']} onclick={() => pg.weather = w}>{w}</button>
			{/each}
		</div>
	</fieldset>

	<fieldset>
		<legend>Imagery</legend>
		{#each MAPLIBRE_SOURCES as src (src.id)}
			<label class={['source-btn', pg.maplibreSource === src.id && 'active']}>
				<input type="radio" name="maplibre-src" checked={pg.maplibreSource === src.id} onchange={() => pg.maplibreSource = src.id} />
				<span class="source-name">{src.label}</span>
				<span class="source-note">{src.note}</span>
			</label>
		{/each}
	</fieldset>

	<fieldset>
		<legend>🗄️ Cached (offline)</legend>
		<p class="field-note">Pre-downloaded for dubai / dallas / himalayas — 189 MB total</p>
		{#each CACHED_SOURCES as src (src.id)}
			<label class={['source-btn', pg.maplibreSource === src.id && 'active']}>
				<input type="radio" name="maplibre-src" checked={pg.maplibreSource === src.id} onchange={() => pg.maplibreSource = src.id} />
				<span class="source-name">{src.label}</span>
				<span class="source-note">{src.note}</span>
			</label>
		{/each}
	</fieldset>

	<fieldset>
		<legend>Layers</legend>
		<label class="check"><input type="checkbox" bind:checked={pg.mlAtmosphere} /> Atmosphere + Sky</label>
		<label class="check"><input type="checkbox" bind:checked={pg.mlTerrain} /> 3D Terrain (raster-dem)</label>
		<label class="check"><input type="checkbox" bind:checked={pg.mlBuildings} /> 3D Buildings (fill-extrusion)</label>
		<label class="check"><input type="checkbox" bind:checked={pg.showCityLights} /> City-light glow (night)</label>
		<label class="check"><input type="checkbox" bind:checked={pg.showLandmarks} /> Curated landmarks</label>
	</fieldset>

	<fieldset>
		<legend>LOD (Pi tuning)</legend>
		<p class="field-note">setSourceTileLodParams — trades distant crispness for lower tile load.</p>
		<label>Max zoom levels <span class="val">{pg.lodMaxZoomLevels}</span>
			<input type="range" bind:value={pg.lodMaxZoomLevels} min="1" max="11" step="1" />
		</label>
		<label>Tile count ratio <span class="val">{pg.lodTileCountRatio.toFixed(1)}</span>
			<input type="range" bind:value={pg.lodTileCountRatio} min="1" max="10" step="0.1" />
		</label>
	</fieldset>

	<fieldset>
		<legend>Clouds</legend>
		<label class="check"><input type="checkbox" bind:checked={pg.useRealisticClouds} /> Photo clouds (SVG feDisplacement)</label>
		<label>Density <span class="val">{(pg.density * 100).toFixed(0)}%</span>
			<input type="range" bind:value={pg.density} min="0" max="1" step="0.01" />
		</label>
		<label>Drift speed <span class="val">{pg.cloudSpeed.toFixed(1)}×</span>
			<input type="range" bind:value={pg.cloudSpeed} min="0.1" max="3" step="0.1" />
		</label>
	</fieldset>

	<fieldset>
		<legend>Plane</legend>
		<label>Heading <span class="val">{pg.heading.toFixed(0)}°</span>
			<input type="range" bind:value={pg.heading} min="0" max="360" step="1" disabled={pg.autoOrbit} />
		</label>
		<label>Speed <span class="val">{pg.planeSpeed.toFixed(1)}×</span>
			<input type="range" bind:value={pg.planeSpeed} min="0.1" max="5" step="0.1" />
		</label>
		<label>Altitude <span class="val">{(pg.altitude / 1000).toFixed(0)}k ft</span>
			<input type="range" bind:value={pg.altitude} min="5000" max="45000" step="1000" />
		</label>
		<label>Turbulence <span class="val">{pg.turbulenceLevel}</span>
			<select bind:value={pg.turbulenceLevel}>
				<option value="light">Light</option>
				<option value="moderate">Moderate</option>
				<option value="severe">Severe</option>
			</select>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={pg.autoOrbit} />
			Auto-orbit heading
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={pg.autoFly} />
			Auto-fly forward
		</label>
	</fieldset>

	<div class="actions">
		<button class="btn" onclick={() => pg.randomize()}>Randomize</button>
		<button class="btn" onclick={() => pg.reset()}>Reset</button>
	</div>
</aside>

<style>
	.drawer {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 340px;
		z-index: 25;
		background: rgba(12, 12, 16, 0.85);
		border-left: 1px solid rgba(255, 255, 255, 0.12);
		padding: 64px 16px 16px;
		overflow-y: auto;
		transform: translateX(100%);
		transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease;
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		box-shadow: -10px 0 30px rgba(0, 0, 0, 0);
	}
	.drawer.open { 
		transform: translateX(0); 
		box-shadow: -10px 0 40px rgba(0, 0, 0, 0.3);
	}

	.drawer::-webkit-scrollbar { width: 6px; }
	.drawer::-webkit-scrollbar-track { background: transparent; }
	.drawer::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }
	.drawer::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }

	.drawer header h2 { font-size: 15px; margin: 0 0 4px 0; }
	.drawer header .hint { margin: 0 0 14px 0; font-size: 11px; color: #999; line-height: 1.4; }

	fieldset { border: 1px solid #222; border-radius: 6px; margin: 0 0 12px 0; padding: 10px 12px; }
	fieldset legend { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; padding: 0 6px; }

	label { display: block; font-size: 12px; color: #ccc; margin: 6px 0; }
	label .val { float: right; color: #7faeff; font-family: ui-monospace, monospace; font-size: 11px; }
	label.check { display: flex; align-items: center; gap: 6px; margin: 8px 0; }

	input[type="range"] { 
		width: 100%; margin: 8px 0; 
		-webkit-appearance: none; appearance: none; background: transparent; 
	}
	input[type="range"]:focus { outline: none; }
	input[type="range"]::-webkit-slider-runnable-track { width: 100%; height: 4px; background: rgba(255, 255, 255, 0.15); border-radius: 2px; transition: background 0.2s; }
	input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none; height: 14px; width: 14px; border-radius: 50%;
		background: #7faeff; cursor: pointer; margin-top: -5px; box-shadow: 0 0 10px rgba(127, 174, 255, 0.4);
		transition: transform 0.2s, box-shadow 0.2s;
	}
	input[type="range"]:hover::-webkit-slider-thumb { transform: scale(1.2); box-shadow: 0 0 14px rgba(127, 174, 255, 0.6); }
	input[type="range"]:disabled::-webkit-slider-thumb { background: #555; box-shadow: none; cursor: not-allowed; }
	input[type="range"]:disabled::-webkit-slider-runnable-track { background: rgba(255, 255, 255, 0.05); }

	.select, select { width: 100%; background: #1a1a20; color: #eee; border: 1px solid #2a2a30; border-radius: 4px; padding: 6px 8px; font-size: 12px; }

	.chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
	.chip-row button {
		flex: 1; min-width: 50px; background: #1a1a20; color: #aaa; border: 1px solid #2a2a30; border-radius: 6px; padding: 6px; font-size: 11px; text-transform: capitalize; cursor: pointer; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.chip-row button:hover { background: #2a2a3a; transform: translateY(-1px); border-color: #445; }
	.chip-row button.active { background: linear-gradient(180deg, #2a4060, #1c2b42); color: #fff; border-color: #4080c0; box-shadow: 0 2px 8px rgba(64, 128, 192, 0.3); }

	.source-btn { display: block; cursor: pointer; margin: 6px 0; padding: 8px 10px; background: #1a1a20; border: 1px solid #2a2a30; border-radius: 6px; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
	.source-btn:hover { background: #22232a; transform: translateX(2px); }
	.source-btn.active { background: linear-gradient(135deg, #1c2b42, #2a4060); border-color: #4080c0; box-shadow: 0 4px 12px rgba(64, 128, 192, 0.15); }
	.source-btn input[type="radio"] { margin-right: 6px; }

	.source-name { font-size: 12px; color: #eee; font-weight: 500; }
	.source-note { display: block; font-size: 10px; color: #888; margin-top: 2px; margin-left: 20px; }

	.field-note { font-size: 10px; color: #777; margin: 0 0 6px 0; line-height: 1.4; }

	.actions { display: flex; gap: 8px; margin-top: 12px; }
	.btn { flex: 1; padding: 8px; background: #2a4060; color: #fff; border: 1px solid #4080c0; border-radius: 4px; font-size: 12px; cursor: pointer; }
	.btn:hover { background: #3a5070; }
</style>
