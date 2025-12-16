<script lang="ts">
	/**
	 * Controls.svelte - Modern comprehensive control panel
	 *
	 * Sections: Presets, Location, Camera, Time, Atmosphere, Window
	 */

	import {
		getViewerState,
		LOCATIONS,
		type LocationId,
	} from "$lib/core/state.svelte";
	import {
		getFlightSimulation,
		FLIGHT_PATHS,
	} from "$lib/core/FlightSimulation.svelte";

	const viewer = getViewerState();
	const flight = getFlightSimulation();

	// UI state
	let showPanel = $state(true);
	let currentFlightPathId = $state<string | null>(null);

	// Real-time sync is handled by ViewerState - we just toggle it

	// Helper to start a flight path and track it
	function startFlightPath(pathId: string) {
		flight.followPath(pathId);
		currentFlightPathId = pathId;
	}

	function startDriftMode() {
		flight.driftMode = true;
		flight.start();
		currentFlightPathId = null;
	}

	// Presets
	const PRESETS = [
		{
			id: "sunrise-dubai",
			name: "Dubai Sunrise",
			location: "dubai" as LocationId,
			altitude: 5000,
			heading: 90,
			pitch: 60,
			time: 6.5,
			showBuildings: true,
			showClouds: true,
			blindOpen: true,
		},
		{
			id: "sunset-mumbai",
			name: "Mumbai Sunset",
			location: "mumbai" as LocationId,
			altitude: 8000,
			heading: 270,
			pitch: 50,
			time: 18.5,
			showBuildings: true,
			showClouds: true,
			blindOpen: true,
		},
		{
			id: "night-vegas",
			name: "Vegas Night",
			location: "las_vegas" as LocationId,
			altitude: 3000,
			heading: 0,
			pitch: 70,
			time: 22,
			showBuildings: true,
			showClouds: false,
			blindOpen: true,
		},
		{
			id: "noon-desert",
			name: "Desert Noon",
			location: "desert" as LocationId,
			altitude: 15000,
			heading: 180,
			pitch: 45,
			time: 12,
			showBuildings: false,
			showClouds: true,
			blindOpen: true,
		},
		{
			id: "high-altitude",
			name: "High Altitude",
			location: "clouds" as LocationId,
			altitude: 35000,
			heading: 90,
			pitch: 30,
			time: 14,
			showBuildings: false,
			showClouds: true,
			blindOpen: true,
		},
		{
			id: "himalayas-dawn",
			name: "Himalayan Dawn",
			location: "himalayas" as LocationId,
			altitude: 25000,
			heading: 45,
			pitch: 40,
			time: 6,
			showBuildings: false,
			showClouds: true,
			blindOpen: true,
		},
	];

	function applyPreset(presetId: string) {
		const preset = PRESETS.find((p) => p.id === presetId);
		if (!preset) return;

		viewer.setLocation(preset.location);
		viewer.setAltitude(preset.altitude);
		viewer.setHeading(preset.heading);
		viewer.pitch = preset.pitch;
		viewer.setTime(preset.time);
		viewer.showBuildings = preset.showBuildings;
		viewer.showClouds = preset.showClouds;
		viewer.blindOpen = preset.blindOpen;
	}

	// Formatting helpers
	function formatTime(time: number): string {
		const hours = Math.floor(time);
		const minutes = Math.floor((time % 1) * 60);
		const period = hours >= 12 ? "PM" : "AM";
		const h = hours % 12 || 12;
		return `${h}:${minutes.toString().padStart(2, "0")} ${period}`;
	}

	function formatAltitude(alt: number): string {
		return `${(alt / 1000).toFixed(1)}k ft`;
	}

	function getCompassDirection(heading: number): string {
		const directions = [
			"N",
			"NNE",
			"NE",
			"ENE",
			"E",
			"ESE",
			"SE",
			"SSE",
			"S",
			"SSW",
			"SW",
			"WSW",
			"W",
			"WNW",
			"NW",
			"NNW",
		];
		const index = Math.round(heading / 22.5) % 16;
		return directions[index];
	}

	function getSkyStateEmoji(state: string): string {
		const map: Record<string, string> = {
			day: "☀️",
			dawn: "🌅",
			dusk: "🌇",
			night: "🌙",
		};
		return map[state] || "☀️";
	}
</script>

<!-- Toggle button when panel is hidden -->
{#if !showPanel}
	<button class="show-panel-btn" onclick={() => (showPanel = true)}>
		Controls
	</button>
{/if}

{#if showPanel}
	<div class="controls-panel">
		<div class="controls-header">
			<h3>Viewer Controls</h3>
			<button class="close-btn" onclick={() => (showPanel = false)}
				>×</button
			>
		</div>

		<!-- Presets Section -->
		<section class="section">
			<h4 class="section-header">Presets</h4>
			<div class="preset-grid">
				{#each PRESETS as preset}
					<button
						class="preset-btn"
						onclick={() => applyPreset(preset.id)}
					>
						{preset.name}
					</button>
				{/each}
			</div>
		</section>

		<!-- Location Section -->
		<section class="section">
			<h4 class="section-header">Location</h4>
			<div class="control-group">
				<label>
					Select Location
					<select
						value={viewer.location}
						onchange={(e) =>
							viewer.setLocation(
								e.currentTarget.value as LocationId,
							)}
					>
						{#each LOCATIONS as loc}
							<option value={loc.id}>{loc.name}</option>
						{/each}
					</select>
				</label>
			</div>
			<div class="coords">
				<span class="coord-label">Lat:</span>
				{viewer.lat.toFixed(4)}°
				<span class="coord-label">Lon:</span>
				{viewer.lon.toFixed(4)}°
			</div>
		</section>

		<!-- Camera Section -->
		<section class="section">
			<h4 class="section-header">Camera</h4>
			<div class="control-group">
				<label>
					Altitude: {formatAltitude(viewer.altitude)}
					<input
						type="range"
						min="500"
						max="45000"
						step="500"
						value={viewer.altitude}
						oninput={(e) =>
							viewer.setAltitude(parseInt(e.currentTarget.value))}
					/>
				</label>
			</div>
			<div class="control-group">
				<label>
					Heading: {viewer.heading}° ({getCompassDirection(
						viewer.heading,
					)})
					<input
						type="range"
						min="0"
						max="360"
						step="5"
						value={viewer.heading}
						oninput={(e) =>
							flight.setBaseHeading(parseInt(e.currentTarget.value))}
					/>
				</label>
			</div>
			<div class="control-group">
				<label>
					Pitch: {viewer.pitch}°
					<input
						type="range"
						min="0"
						max="90"
						step="5"
						value={viewer.pitch}
						oninput={(e) =>
							flight.setBasePitch(parseInt(e.currentTarget.value))}
					/>
				</label>
			</div>
		</section>

		<!-- Flight Section -->
		<section class="section">
			<h4 class="section-header">Flight</h4>
			<div class="control-group">
				<label class:disabled={!flight.driftMode}>
					Ground Speed: {flight.groundSpeed} kts {!flight.driftMode
						? "(path override)"
						: ""}
					<input
						type="range"
						min="100"
						max="500"
						step="10"
						value={flight.groundSpeed}
						disabled={!flight.driftMode}
						oninput={(e) =>
							(flight.groundSpeed = parseInt(
								e.currentTarget.value,
							))}
					/>
				</label>
			</div>
			<div class="flight-paths">
				<span class="label">Flight Paths:</span>
				<div class="path-buttons">
					<button
						class="path-btn"
						class:active={flight.driftMode &&
							currentFlightPathId === null}
						onclick={startDriftMode}
					>
						Drift
					</button>
					{#each FLIGHT_PATHS as path}
						<button
							class="path-btn"
							class:active={currentFlightPathId === path.id}
							onclick={() => startFlightPath(path.id)}
						>
							{path.name}
						</button>
					{/each}
				</div>
			</div>
		</section>

		<!-- Time Section -->
		<section class="section">
			<h4 class="section-header">Time</h4>
			<div class="control-group">
				<label>
					Time of Day: {formatTime(viewer.timeOfDay)}
					<input
						type="range"
						min="0"
						max="24"
						step="0.25"
						value={viewer.timeOfDay}
						oninput={(e) =>
							viewer.setTime(parseFloat(e.currentTarget.value))}
						disabled={viewer.syncToRealTime}
					/>
				</label>
			</div>
			<label class="toggle">
				<input
					type="checkbox"
					checked={viewer.syncToRealTime}
					onchange={() =>
						(viewer.syncToRealTime = !viewer.syncToRealTime)}
				/>
				Sync to real time
			</label>
			<div class="sky-state">
				{getSkyStateEmoji(viewer.skyState)}
				{viewer.skyState.toUpperCase()}
			</div>
		</section>

		<!-- Atmosphere Section -->
		<section class="section">
			<h4 class="section-header">Atmosphere</h4>
			<div class="control-group">
				<label>
					Cloud Density: {viewer.cloudDensity.toFixed(2)}
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={viewer.cloudDensity}
						oninput={(e) =>
							(viewer.cloudDensity = parseFloat(
								e.currentTarget.value,
							))}
					/>
				</label>
			</div>
			<div class="control-group">
				<label>
					Haze: {(viewer.haze * 100).toFixed(0)}%
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={viewer.haze}
						oninput={(e) =>
							(viewer.haze = parseFloat(e.currentTarget.value))}
					/>
				</label>
			</div>
			<div class="control-group">
				<label>
					Weather
					<select
						value={viewer.weather}
						onchange={(e) =>
							(viewer.weather = e.currentTarget.value as
								| "clear"
								| "cloudy"
								| "overcast"
								| "storm")}
					>
						<option value="clear">Clear</option>
						<option value="cloudy">Cloudy</option>
						<option value="overcast">Overcast</option>
						<option value="storm">Storm</option>
					</select>
				</label>
			</div>
			<div class="toggles">
				<label class="toggle">
					<input
						type="checkbox"
						checked={viewer.showClouds}
						onchange={() => viewer.toggleClouds()}
					/>
					Show Clouds
				</label>
				<label class="toggle">
					<input
						type="checkbox"
						checked={viewer.showBuildings}
						onchange={() => viewer.toggleBuildings()}
					/>
					Show Buildings
				</label>
			</div>
		</section>

		<!-- Window Section -->
		<section class="section">
			<h4 class="section-header">Window</h4>
			<label class="toggle">
				<input
					type="checkbox"
					checked={viewer.blindOpen}
					onchange={() => viewer.toggleBlind()}
				/>
				Blind Open
			</label>
		</section>
	</div>
{/if}

<style>
	.show-panel-btn {
		position: fixed;
		top: 1rem;
		right: 1rem;
		background: rgba(0, 0, 0, 0.8);
		color: white;
		border: 1px solid #444;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		cursor: pointer;
		z-index: 100;
		font-size: 0.8rem;
		transition: background 0.2s;
	}

	.show-panel-btn:hover {
		background: rgba(0, 0, 0, 0.95);
	}

	.controls-panel {
		position: fixed;
		top: 1rem;
		right: 1rem;
		background: rgba(0, 0, 0, 0.92);
		color: white;
		padding: 1rem;
		border-radius: 12px;
		font-size: 0.85rem;
		z-index: 100;
		width: 280px;
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		backdrop-filter: blur(5px);
		border: 1px solid rgba(74, 158, 255, 0.2);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}

	.controls-panel::-webkit-scrollbar {
		width: 6px;
	}

	.controls-panel::-webkit-scrollbar-track {
		background: rgba(255, 255, 255, 0.05);
		border-radius: 3px;
	}

	.controls-panel::-webkit-scrollbar-thumb {
		background: rgba(74, 158, 255, 0.3);
		border-radius: 3px;
	}

	.controls-panel::-webkit-scrollbar-thumb:hover {
		background: rgba(74, 158, 255, 0.5);
	}

	.controls-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid rgba(74, 158, 255, 0.3);
	}

	.controls-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: #4a9eff;
		text-shadow: 0 0 10px rgba(74, 158, 255, 0.3);
	}

	.close-btn {
		background: rgba(255, 255, 255, 0.1);
		color: white;
		border: 1px solid rgba(255, 255, 255, 0.2);
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 1.2rem;
		line-height: 1;
		transition: all 0.2s;
	}

	.close-btn:hover {
		background: rgba(255, 255, 255, 0.2);
		border-color: rgba(255, 255, 255, 0.3);
	}

	.section {
		margin-bottom: 1.25rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.section:last-child {
		border-bottom: none;
		margin-bottom: 0;
		padding-bottom: 0;
	}

	.section-header {
		margin: 0 0 0.75rem 0;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgba(74, 158, 255, 0.8);
	}

	.preset-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.preset-btn {
		background: rgba(74, 158, 255, 0.15);
		color: white;
		border: 1px solid rgba(74, 158, 255, 0.3);
		padding: 0.5rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.7rem;
		transition: all 0.2s;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.preset-btn:hover {
		background: rgba(74, 158, 255, 0.25);
		border-color: rgba(74, 158, 255, 0.5);
		transform: translateY(-1px);
	}

	.preset-btn:active {
		transform: translateY(0);
	}

	/* Flight path controls */
	.flight-paths {
		margin-top: 0.5rem;
	}

	.flight-paths .label {
		font-size: 0.7rem;
		opacity: 0.7;
		display: block;
		margin-bottom: 0.4rem;
	}

	.path-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.path-btn {
		padding: 0.35rem 0.6rem;
		font-size: 0.65rem;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 4px;
		color: white;
		cursor: pointer;
		transition: all 0.2s;
	}

	.path-btn:hover {
		background: rgba(74, 158, 255, 0.2);
		border-color: rgba(74, 158, 255, 0.4);
	}

	.path-btn.active {
		background: rgba(74, 158, 255, 0.3);
		border-color: rgba(74, 158, 255, 0.6);
		color: #4a9eff;
	}

	.control-group {
		margin-bottom: 0.75rem;
	}

	.control-group:last-child {
		margin-bottom: 0;
	}

	label {
		display: block;
		font-size: 0.75rem;
		opacity: 0.9;
	}

	input[type="range"] {
		width: 100%;
		margin-top: 0.4rem;
		accent-color: #4a9eff;
		cursor: pointer;
	}

	input[type="range"]:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	label.disabled {
		opacity: 0.6;
	}

	select {
		width: 100%;
		margin-top: 0.4rem;
		padding: 0.5rem;
		background: rgba(255, 255, 255, 0.05);
		color: white;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 6px;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	select:hover {
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(74, 158, 255, 0.4);
	}

	select:focus {
		outline: none;
		border-color: #4a9eff;
		box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.2);
	}

	.coords {
		margin-top: 0.5rem;
		font-size: 0.7rem;
		padding: 0.4rem 0.6rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 4px;
		font-family: "Courier New", monospace;
	}

	.coord-label {
		color: rgba(74, 158, 255, 0.8);
		font-weight: 600;
		margin-left: 0.5rem;
	}

	.coord-label:first-child {
		margin-left: 0;
	}

	.toggles {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0.3rem 0;
		transition: opacity 0.2s;
	}

	.toggle:hover {
		opacity: 1;
	}

	.toggle input[type="checkbox"] {
		accent-color: #4a9eff;
		cursor: pointer;
		width: 16px;
		height: 16px;
	}

	.sky-state {
		margin-top: 0.5rem;
		padding: 0.5rem;
		background: rgba(74, 158, 255, 0.1);
		border: 1px solid rgba(74, 158, 255, 0.3);
		border-radius: 6px;
		text-align: center;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.05em;
	}
</style>
