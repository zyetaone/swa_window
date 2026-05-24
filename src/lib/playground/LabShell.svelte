<script lang="ts">
	/**
	 * LabShell — shared chrome for the lean R&D playground routes (/playground and /playground/three).
	 *
	 * Eliminates the ~120 LOC dupe of drawer + toggle + base fieldsets + dark lab CSS
	 * that used to live in both +page.svelte files.
	 *
	 * Deletable: if the labs go away, delete this file + the two thin wrappers revert to self-contained.
	 *
	 * Usage (example):
	 *   <LabShell title="Scene Lab" hint="Cesium...">
	 *     {#snippet viewer()}
	 *       <CesiumViewer />
	 *       <Compositor />
	 *     {/snippet}
	 *     {#snippet extraControls()}
	 *       <!-- clouds fieldset etc -->
	 *     {/snippet}
	 *   </LabShell>
	 *
	 * The three route additionally passes a `diag` snippet for the always-visible HUD
	 * and uses the `cityMode` / `onCityToggle` props for its special button + effect.
	 */
	import type { Snippet } from 'svelte';
	import { LOCATIONS } from '$content/locations';
	import { WEATHER_TYPES, type LocationId, type WeatherType } from '$lib/types';
	import { formatTime } from '$lib/utils';
	import type { AeroWindow } from '$lib/model/aero-window.svelte';

	let {
		title,
		hint,
		model,
		viewer,
		extraControls,
		diag,
		showCityMode = false,
		cityMode = $bindable(false),
		onCityToggle,
	}: {
		title: string;
		hint?: string;
		model: AeroWindow;
		viewer: Snippet;
		extraControls?: Snippet;
		diag?: Snippet;
		showCityMode?: boolean;
		cityMode?: boolean;
		onCityToggle?: () => void;
	} = $props();

	let drawerOpen = $state(false);
</script>

<div class="playground">
	<div class="globe-pane">
		{@render viewer()}
	</div>

	<!-- Optional always-visible diag (three.js lab) or other HUD -->
	{#if diag}
		{@render diag()}
	{/if}

	<button
		class={['drawer-toggle', drawerOpen && 'open']}
		onclick={() => (drawerOpen = !drawerOpen)}
		aria-label="Toggle settings"
	>
		{drawerOpen ? '✕' : '⚙'}
	</button>

	<aside class={['drawer', drawerOpen && 'open']} aria-hidden={!drawerOpen}>
		<header>
			<h2>{title}</h2>
			{#if hint}
				<p class="hint">{hint}</p>
			{/if}
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
				<input
					type="range"
					value={model.timeOfDay}
					min="0"
					max="24"
					step="0.1"
					oninput={(e) => model.setTime(parseFloat((e.currentTarget as HTMLInputElement).value))}
				/>
			</label>
		</fieldset>

		<fieldset>
			<legend>Weather</legend>
			<div class="chip-row">
				{#each WEATHER_TYPES as w (w)}
					<button
						type="button"
						class={[model.weather === w && 'active']}
						onclick={() => model.setWeather(w as WeatherType)}
					>
						{w}
					</button>
				{/each}
			</div>
		</fieldset>

		<!-- Extra controls from the specific lab (clouds, altitude+city, night, etc.) -->
		{#if extraControls}
			{@render extraControls()}
		{/if}

		{#if showCityMode}
			<fieldset>
				<legend>Altitude</legend>
				<label>
					{model.flight.altitude >= 1000
						? `${(model.flight.altitude / 1000).toFixed(1)}k ft`
						: `${model.flight.altitude.toFixed(0)} ft`}
					<input
						type="range"
						value={model.flight.altitude}
						min="100"
						max="65000"
						step="100"
						oninput={(e) => {
							const v = parseFloat((e.currentTarget as HTMLInputElement).value);
							model.flight.altitude = v;
							model.onUserInteraction('altitude');
						}}
					/>
				</label>
				<button
					type="button"
					class={['city-btn', cityMode && 'active']}
					onclick={() => {
						if (onCityToggle) onCityToggle();
						else cityMode = !cityMode;
					}}
				>
					{cityMode ? '✓ City Mode (pinned 500 ft)' : 'City Approach (500 ft)'}
				</button>
			</fieldset>
		{/if}
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

	.city-btn {
		width: 100%;
		padding: 8px;
		background: rgba(255, 154, 74, 0.18);
		border: 1px solid rgba(255, 154, 74, 0.4);
		border-radius: 6px;
		color: #ffd0a0;
		font-size: 11px;
		cursor: pointer;
		margin-top: 4px;
	}
	.city-btn:hover { background: rgba(255, 154, 74, 0.28); }
	.city-btn.active {
		background: rgba(255, 154, 74, 0.4);
		border-color: rgba(255, 200, 130, 0.8);
		color: #fff5e6;
	}
</style>
