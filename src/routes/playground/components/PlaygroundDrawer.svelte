<script lang="ts">
	import { LOCATIONS } from '$lib/locations';
	import { WEATHER_TYPES } from '$lib/types';
	import { formatTime } from '$lib/utils';
	import { MAPLIBRE_SOURCES, CACHED_SOURCES } from '../imagery';
	import { pg, pgReset, pgRandomize, ALT_HOLD_SEC, HDG_HOLD_SEC } from '../lib/playground-state.svelte';
	import { getSkyState } from '$lib/utils';

	let { drawerOpen = $bindable(false) } : { drawerOpen?: boolean } = $props();

	const skyState = $derived(getSkyState(pg.timeOfDay));

	function compassDir(deg: number): string {
		const dirs = ['N','NE','E','SE','S','SW','W','NW'];
		return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
	}
</script>

<!-- Settings drawer — slides in from right -->
<aside class="drawer" class:open={drawerOpen} aria-hidden={!drawerOpen}>
	<header>
		<h2>Scene Lab</h2>
		<p class="hint">MapLibre globe + atmosphere + terrain + buildings. GeoJSON-driven styling.</p>
	</header>

	<div class="compass-bar">
		<div class="compass-arrow" style:transform="rotate({pg.heading}deg)"></div>
		<span class="compass-heading">{pg.heading.toFixed(0)}° {compassDir(pg.heading)}</span>
		<span class="compass-alt">ALT {(pg.altitude / 1000).toFixed(0)}k ft</span>
	</div>

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
		<label class="check">
			<input type="checkbox" bind:checked={pg.abstractionEnabled} /> 
			<b>Artwork Abstraction</b> (Tactile layers)
		</label>
		<div class="field-divider"></div>
		<label class="check"><input type="checkbox" bind:checked={pg.mlAtmosphere} /> Atmosphere + Sky</label>
		<label class="check"><input type="checkbox" bind:checked={pg.mlTerrain} /> 3D Terrain (raster-dem)</label>
		<label class="check"><input type="checkbox" bind:checked={pg.mlBuildings} /> 3D Buildings (fill-extrusion)</label>
		<label class="check"><input type="checkbox" bind:checked={pg.showCityLights} /> City-light glow (night)</label>
		<label class="check"><input type="checkbox" bind:checked={pg.showLandmarks} /> Curated landmarks</label>
		<div class="field-divider"></div>
		<p class="field-note">LOD — trades distant crispness for lower tile load.</p>
		<label>Max zoom levels <span class="val">{pg.lodMaxZoomLevels}</span>
			<input type="range" bind:value={pg.lodMaxZoomLevels} min="1" max="11" step="1" />
		</label>
		<label>Tile count ratio <span class="val">{pg.lodTileCountRatio.toFixed(1)}</span>
			<input type="range" bind:value={pg.lodTileCountRatio} min="1" max="10" step="0.1" />
		</label>
	</fieldset>

	<fieldset>
		<legend>Clouds</legend>
		<div class="chip-row">
			<button type="button" class={[pg.cloudMode === 'sim' && 'active']} onclick={() => pg.cloudMode = 'sim'}>Sim</button>
			<button type="button" class={[pg.cloudMode === 'artsy' && 'active']} onclick={() => pg.cloudMode = 'artsy'}>Artsy</button>
		</div>
		<div class="field-divider"></div>
		<label>Density <span class="val">{(pg.density * 100).toFixed(0)}%</span>
			<input type="range" bind:value={pg.density} min="0" max="1" step="0.01" />
		</label>
		<label>Drift speed <span class="val">{pg.cloudSpeed.toFixed(1)}×</span>
			<input type="range" bind:value={pg.cloudSpeed} min="0.1" max="3" step="0.1" />
		</label>
		<label>Cloud size <span class="val">{pg.cloudScale.toFixed(1)}×</span>
			<input type="range" bind:value={pg.cloudScale} min="0.3" max="2.5" step="0.1" />
		</label>
		<label>Cloud spread <span class="val">{pg.cloudSpread.toFixed(1)}×</span>
			<input type="range" bind:value={pg.cloudSpread} min="0.3" max="3.0" step="0.1" />
		</label>
	</fieldset>


	<fieldset>
		<legend>Plane</legend>
		<label>Heading <span class="val">{pg.heading.toFixed(0)}°</span>
			<input type="range" value={pg.heading} min="0" max="360" step="1" disabled={pg.autoOrbit || pg.autoFly}
				oninput={(e) => { pg.heading = +e.currentTarget.value; pg.headingCooldown = HDG_HOLD_SEC; }} />
		</label>
		<label>Orbit Speed <span class="val">{pg.orbitAngularSpeed.toFixed(3)}</span>
			<input type="range" bind:value={pg.orbitAngularSpeed} min="0.01" max="0.3" step="0.01" />
		</label>
		<label>Speed <span class="val">{pg.planeSpeed.toFixed(1)}×</span>
			<input type="range" bind:value={pg.planeSpeed} min="0.1" max="5" step="0.1" />
		</label>
		<label>Altitude <span class="val">{(pg.altitude / 1000).toFixed(0)}k ft</span>
			<input type="range" value={pg.altitude} min="5000" max="45000" step="1000"
				oninput={(e) => { pg.altitude = +e.currentTarget.value; pg.altitudeCooldown = ALT_HOLD_SEC; }} />
		</label>
		<label>Turbulence <span class="val">{pg.turbulenceLevel}</span>
			<select bind:value={pg.turbulenceLevel}>
				<option value="light">Light</option>
				<option value="moderate">Moderate</option>
				<option value="severe">Severe</option>
			</select>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={pg.kioskMode} />
			Kiosk (Auto-cycle locations)
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={pg.autoFly} />
			Auto-fly (Orbital)
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={pg.autoOrbit} disabled={pg.autoFly} />
			Auto-orbit (Heading drift)
		</label>
	</fieldset>

	<div class="actions">
		<button class="btn" onclick={pgRandomize}>Randomize</button>
		<button class="btn" onclick={pgReset}>Reset</button>
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
		background: rgba(10, 10, 15, 0.94);
		border-left: 1px solid rgba(255, 255, 255, 0.12);
		padding: 64px 16px 16px;
		overflow-y: auto;
		transform: translateX(100%);
		transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease;
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

	.drawer header h2 { font-size: 16px; margin: 0 0 4px 0; color: #fff; letter-spacing: -0.2px; }
	.drawer header .hint { margin: 0 0 16px 0; font-size: 11px; color: #888; line-height: 1.4; }

	fieldset { 
		border: 1px solid rgba(255, 255, 255, 0.08); 
		border-radius: 12px; 
		margin: 0 0 16px 0; 
		padding: 12px;
		background: rgba(255, 255, 255, 0.02);
	}
	fieldset legend { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; padding: 0 8px; font-weight: 600; }

	label { display: block; font-size: 12px; color: #ccc; margin: 8px 0; }
	label .val { float: right; color: #7faeff; font-family: ui-monospace, monospace; font-size: 11px; font-weight: 500; }
	label.check { display: flex; align-items: center; gap: 8px; margin: 10px 0; cursor: pointer; color: #bbb; transition: color 0.2s; }
	label.check:hover { color: #fff; }
	label.check input { width: 14px; height: 14px; margin: 0; }

	input[type="range"] { 
		width: 100%; margin: 8px 0; 
		-webkit-appearance: none; appearance: none; background: transparent; 
	}
	input[type="range"]:focus { outline: none; }
	input[type="range"]::-webkit-slider-runnable-track { width: 100%; height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; }
	input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none; height: 14px; width: 14px; border-radius: 50%;
		background: #7faeff; cursor: pointer; margin-top: -5px; box-shadow: 0 0 10px rgba(127, 174, 255, 0.4);
		transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
	}
	input[type="range"]:hover::-webkit-slider-thumb { transform: scale(1.2); box-shadow: 0 0 15px rgba(127, 174, 255, 0.6); }

	.select, select { 
		width: 100%; 
		background: rgba(0, 0, 0, 0.3); 
		color: #eee; 
		border: 1px solid rgba(255, 255, 255, 0.1); 
		border-radius: 6px; 
		padding: 6px 8px; 
		font-size: 12px;
		outline: none;
		transition: border-color 0.2s;
	}
	.select:focus, select:focus { border-color: rgba(127, 174, 255, 0.5); }

	.chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip-row button {
		flex: 1; min-width: 60px; background: rgba(255, 255, 255, 0.05); color: #888; 
		border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 8px; 
		font-size: 11px; text-transform: capitalize; cursor: pointer; 
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.chip-row button:hover { background: rgba(255, 255, 255, 0.1); transform: translateY(-1px); color: #ccc; }
	.chip-row button.active { 
		background: linear-gradient(180deg, #2a4060, #1c2b42); 
		color: #fff; border-color: #4080c0; 
		box-shadow: 0 4px 12px rgba(64, 128, 192, 0.3); 
	}

	.source-btn { 
		display: block; cursor: pointer; margin: 6px 0; padding: 10px; 
		background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); 
		border-radius: 10px; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); 
	}
	.source-btn:hover { background: rgba(255, 255, 255, 0.08); transform: translateX(2px); border-color: rgba(255, 255, 255, 0.2); }
	.source-btn.active { 
		background: linear-gradient(135deg, #1c2b42, #2a4060); 
		border-color: #4080c0; 
		box-shadow: 0 4px 12px rgba(64, 128, 192, 0.2); 
	}
	.source-name { display: block; font-size: 12px; color: #eee; font-weight: 500; }
	.source-note { display: block; font-size: 10px; color: #777; margin-top: 4px; line-height: 1.3; }

	.actions { display: flex; gap: 10px; margin-top: 20px; }
	.btn { 
		flex: 1; padding: 10px; 
		background: rgba(42, 64, 96, 0.6); 
		color: #fff; border: 1px solid rgba(64, 128, 192, 0.4); 
		border-radius: 8px; font-size: 12px; cursor: pointer;
		transition: all 0.2s;
	}
	.btn:hover { background: rgba(58, 80, 112, 0.8); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); }

	.compass-bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		margin: 0 0 12px;
		background: rgba(0, 0, 0, 0.3);
		border-radius: 10px;
		font-size: 12px;
		color: #aab;
	}
	.compass-arrow {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.15);
		position: relative;
		flex-shrink: 0;
	}
	.compass-arrow::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 50%;
		transform: translateX(-50%);
		width: 0;
		height: 0;
		border-left: 4px solid transparent;
		border-right: 4px solid transparent;
		border-bottom: 8px solid #7faeff;
	}
	.compass-heading {
		font-family: ui-monospace, monospace;
		color: #7faeff;
		font-weight: 600;
	}
	.compass-alt {
		margin-left: auto;
		font-family: ui-monospace, monospace;
		color: #8a8;
	}

	.field-divider {
		height: 1px;
		background: rgba(255, 255, 255, 0.06);
		margin: 12px 0 8px;
	}
</style>
