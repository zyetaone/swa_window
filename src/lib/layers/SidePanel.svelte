<script lang="ts">
	/**
	 * SidePanel - Right-side slide-out panel
	 *
	 * Contains: location picker, settings, flight data.
	 * Toggled via tab button on right edge of cabin wall.
	 */
	import {
		useAppState,
		LOCATIONS,
		AIRCRAFT,
		type LocationId,
	} from "$lib/core";
	import { formatTime } from "$lib/core/utils";
	import AirlineLoader from "./AirlineLoader.svelte";
	import Toggle from "./controls/Toggle.svelte";
	import RangeSlider from "./controls/RangeSlider.svelte";

	const model = useAppState();

	let panelOpen = $state(false);

	const cities = LOCATIONS.filter((l) => l.hasBuildings);
	const nature = LOCATIONS.filter((l) => !l.hasBuildings);

	function flyTo(locationId: LocationId) {
		model.flyTo(locationId);
	}

	function togglePanel() {
		panelOpen = !panelOpen;
	}
</script>

<!-- Tab button (always visible on right edge) -->
<button
	class="panel-tab"
	class:open={panelOpen}
	onclick={togglePanel}
	type="button"
	aria-label={panelOpen ? "Close settings" : "Open settings"}
>
	<svg
		class="tab-icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
	>
		{#if panelOpen}
			<path d="M9 18l6-6-6-6" />
		{:else}
			<path d="M15 18l-6-6 6-6" />
		{/if}
	</svg>
</button>

<!-- Slide-out panel -->
{#if panelOpen}
	<button
		class="backdrop"
		onclick={togglePanel}
		type="button"
		aria-label="Close settings panel"
		tabindex="-1"
	></button>

	<div class="panel">
		<header>
			<h2>Sky Portal</h2>
		</header>

		<!-- Flight Data -->
		<div class="flight-data">
			<div class="data-row">
				<div class="data-item">
					<span class="data-label">ALT</span>
					<span class="data-value"
						>{(model.altitude / 1000).toFixed(1)}<small>k ft</small
						></span
					>
				</div>
				<div class="data-item">
					<span class="data-label">GS</span>
					<span class="data-value"
						>{model.flightSpeed.toFixed(1)}<small>x</small></span
					>
				</div>
				<div class="data-item">
					<span class="data-label">LOC</span>
					<span class="data-value"
						>{formatTime(model.localTimeOfDay)}</span
					>
				</div>
			</div>
			<div class="current-location">{model.currentLocation.name}</div>
		</div>

		<!-- Transition status -->
		{#if model.isTransitioning && model.cruiseDestinationName}
			<div class="transition-status">
				<div class="loader-wrapper">
					<AirlineLoader />
				</div>
				<div class="status-text">
					<span class="dest-label">DESTINATION</span>
					<span class="dest-name">{model.cruiseDestinationName}</span>
				</div>
			</div>
		{/if}

		<div class="divider"></div>

		<!-- Location Grid -->
		<section>
			<h4>Cities</h4>
			<div class="location-grid">
				{#each cities as loc}
					<button
						class="loc-btn"
						class:active={model.location === loc.id}
						onclick={() => flyTo(loc.id)}
					>
						{loc.name}
					</button>
				{/each}
			</div>
		</section>

		<section>
			<h4>Nature</h4>
			<div class="location-grid">
				{#each nature as loc}
					<button
						class="loc-btn"
						class:active={model.location === loc.id}
						onclick={() => flyTo(loc.id)}
					>
						{loc.name}
					</button>
				{/each}
			</div>
		</section>

		<div class="divider"></div>

		<!-- Settings -->
		<section class="settings">
			<h4>Time</h4>
			<Toggle
				label="Real Time"
				checked={model.syncToRealTime}
				onchange={() =>
					model.applyPatch({ syncToRealTime: !model.syncToRealTime })}
			/>

			{#if !model.syncToRealTime}
				<RangeSlider
					id="time"
					label="Time of Day"
					min={0}
					max={24}
					step={0.25}
					value={model.localTimeOfDay}
					formatValue={(v) => formatTime(v)}
					oninput={(e) =>
						model.setTime(parseFloat(e.currentTarget.value))}
				/>
			{/if}

			<div class="divider"></div>

			<h4>Flight</h4>
			<RangeSlider
				id="speed"
				label="Cruising Speed"
				min={0.1}
				max={3.0}
				step={0.1}
				value={model.flightSpeed}
				formatValue={(v) => v.toFixed(1) + "x"}
				oninput={(e) =>
					model.applyPatch({
						flightSpeed: parseFloat(e.currentTarget.value),
					})}
			/>
			<RangeSlider
				id="altitude"
				label="Altitude"
				min={AIRCRAFT.MIN_ALTITUDE}
				max={AIRCRAFT.MAX_ALTITUDE}
				step={1000}
				value={model.altitude}
				formatValue={(v) => (v / 1000).toFixed(0) + "k ft"}
				oninput={(e) =>
					model.setAltitude(parseFloat(e.currentTarget.value))}
			/>

			<div class="divider"></div>

			<h4>Atmosphere</h4>
			<RangeSlider
				id="clouds"
				label="Cloud Cover"
				min={0}
				max={1.0}
				step={0.05}
				value={model.cloudDensity}
				formatValue={(v) => Math.round(v * 100) + "%"}
				oninput={(e) =>
					model.applyPatch({
						cloudDensity: parseFloat(e.currentTarget.value),
					})}
			/>
			<RangeSlider
				id="cloudSpeed"
				label="Cloud Speed"
				min={0.1}
				max={2.0}
				step={0.1}
				value={model.cloudSpeed}
				formatValue={(v) => v.toFixed(1) + "x"}
				oninput={(e) =>
					model.applyPatch({
						cloudSpeed: parseFloat(e.currentTarget.value),
					})}
			/>
			<RangeSlider
				id="haze"
				label="Haze"
				min={0}
				max={0.15}
				step={0.005}
				value={model.haze}
				formatValue={(v) => Math.round(v * 100) + "%"}
				oninput={(e) =>
					model.applyPatch({
						haze: parseFloat(e.currentTarget.value),
					})}
			/>
			<RangeSlider
				id="terrainDark"
				label="Terrain Darkness"
				min={0}
				max={1.0}
				step={0.05}
				value={model.terrainDarkness}
				formatValue={(v) => Math.round(v * 100) + "%"}
				oninput={(e) =>
					model.applyPatch({
						terrainDarkness: parseFloat(e.currentTarget.value),
					})}
			/>

			<div class="divider"></div>

			<h4>Lighting</h4>
			<RangeSlider
				id="nightLight"
				label="Night Lights"
				min={0}
				max={5.0}
				step={0.1}
				value={model.nightLightIntensity}
				formatValue={(v) => v.toFixed(1)}
				oninput={(e) =>
					model.applyPatch({
						nightLightIntensity: parseFloat(
							e.currentTarget.value,
						),
					})}
			/>

			<div class="divider"></div>

			<h4>Weather</h4>
			<div class="weather-grid">
				<button
					class="weather-btn"
					class:active={model.weather === "clear"}
					onclick={() => model.setWeather("clear")}>Clear</button
				>
				<button
					class="weather-btn"
					class:active={model.weather === "cloudy"}
					onclick={() => model.setWeather("cloudy")}>Cloudy</button
				>
				<button
					class="weather-btn"
					class:active={model.weather === "overcast"}
					onclick={() => model.setWeather("overcast")}>Overcast</button
				>
				<button
					class="weather-btn"
					class:active={model.weather === "rain"}
					onclick={() => model.setWeather("rain")}>Rain</button
				>
				<button
					class="weather-btn"
					class:active={model.weather === "storm"}
					onclick={() => model.setWeather("storm")}>Storm</button
				>
			</div>
		</section>

	</div>
{/if}

<style>
	/* --- Tab button --- */

	.panel-tab {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		z-index: 100;
		width: 44px;
		height: 64px;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-right: none;
		border-radius: 10px 0 0 10px;
		color: rgba(255, 255, 255, 0.8);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.panel-tab:hover {
		background: rgba(0, 0, 0, 0.55);
		color: white;
		width: 48px;
	}

	.panel-tab.open {
		right: 300px;
	}

	.tab-icon {
		width: 20px;
		height: 20px;
	}

	/* --- Backdrop --- */

	.backdrop {
		position: absolute;
		inset: 0;
		z-index: 99;
		background: transparent;
		border: none;
		cursor: default;
		padding: 0;
	}

	/* --- Panel --- */

	.panel {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 300px;
		z-index: 100;
		background: rgba(10, 10, 30, 0.88);
		border-left: 1px solid rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.9);
		overflow-y: auto;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		animation: panel-slide-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}

	@keyframes panel-slide-in {
		from {
			transform: translateX(100%);
			opacity: 0.8;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}


	/* --- Header --- */

	header {
		text-align: left;
	}

	h2 {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 700;
		background: linear-gradient(135deg, #fff 0%, #ccc 100%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		letter-spacing: -0.01em;
	}

	/* --- Flight Data --- */

	.flight-data {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		padding: 0.8rem;
	}

	.data-row {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.data-item {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.data-label {
		font-size: 0.625rem;
		opacity: 0.5;
		letter-spacing: 0.2em;
		font-weight: 400;
		margin-bottom: 0.15rem;
	}

	.data-value {
		font-family: "JetBrains Mono", "Fira Code", monospace;
		font-size: 0.85rem;
		font-weight: 400;
		letter-spacing: 0.05em;
	}

	.data-value small {
		font-size: 0.7em;
		opacity: 0.6;
		margin-left: 0.15em;
	}

	.current-location {
		text-align: center;
		font-size: 0.75rem;
		font-weight: 300;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		opacity: 0.7;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding-top: 0.5rem;
	}

	/* --- Transition Status --- */

	.transition-status {
		background: rgba(0, 0, 0, 0.25);
		border-radius: 8px;
		padding: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.loader-wrapper {
		flex-shrink: 0;
	}

	.status-text {
		display: flex;
		flex-direction: column;
	}

	.dest-label {
		font-size: 0.65rem;
		opacity: 0.5;
		letter-spacing: 0.15em;
		text-transform: uppercase;
	}

	.dest-name {
		font-size: 1rem;
		font-weight: 700;
		color: var(--sw-yellow);
	}

	/* --- Divider --- */

	.divider {
		height: 1px;
		background: linear-gradient(
			90deg,
			transparent,
			rgba(255, 255, 255, 0.2),
			transparent
		);
	}

	/* --- Location Grid --- */

	section {
		margin-bottom: 0.2rem;
	}

	h4 {
		margin: 0 0 0.4rem 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.55;
		font-weight: 500;
	}

	.location-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.loc-btn {
		padding: 0.45rem 0.75rem;
		font-size: 0.75rem;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 5px;
		color: white;
		cursor: pointer;
		transition: all 0.15s;
	}

	.loc-btn:hover {
		background: rgba(255, 255, 255, 0.15);
		border-color: rgba(255, 255, 255, 0.25);
	}

	.loc-btn.active {
		background: rgba(48, 76, 178, 0.4);
		border-color: var(--sw-blue);
		box-shadow: 0 0 8px rgba(48, 76, 178, 0.4);
	}

	/* --- Settings --- */

	.settings {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	.weather-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.weather-btn {
		padding: 0.45rem 0.75rem;
		font-size: 0.75rem;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 5px;
		color: rgba(255, 255, 255, 0.7);
		cursor: pointer;
		text-align: center;
		transition: all 0.2s;
	}

	.weather-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: white;
	}

	.weather-btn.active {
		background: rgba(48, 76, 178, 0.5);
		border-color: var(--sw-blue);
		color: white;
		font-weight: 500;
	}

	:global(.panel .control input[type="range"]) {
		background: rgba(255, 255, 255, 0.1);
	}

	/* --- Footer --- */

</style>
