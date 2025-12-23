<script lang="ts">
	/**
	 * Controls.svelte - Minimal kiosk-friendly control panel
	 *
	 * Design: Hidden by default, tap to reveal, auto-hide after inactivity
	 * For circadian-aware passive display - not a complex control app
	 */

	import { useAppState, LOCATIONS, type LocationId } from "$lib/core";

	const { model } = useAppState();

	// Panel visibility state
	let showPanel = $state(false);
	let showAdvanced = $state(false);
	let hideTimeout: ReturnType<typeof setTimeout> | null = null;

	// Auto-hide after 8 seconds of inactivity
	const AUTO_HIDE_MS = 8000;

	function resetHideTimer() {
		if (hideTimeout) clearTimeout(hideTimeout);
		hideTimeout = setTimeout(() => {
			showPanel = false;
			showAdvanced = false;
		}, AUTO_HIDE_MS);
	}

	function openPanel() {
		showPanel = true;
		resetHideTimer();
	}

	function closePanel() {
		showPanel = false;
		showAdvanced = false;
		if (hideTimeout) clearTimeout(hideTimeout);
	}

	function handleInteraction() {
		if (showPanel) resetHideTimer();
	}

	// Location selection with smooth transition
	function flyTo(locationId: LocationId) {
		model.setLocation(locationId);
		handleInteraction();
	}

	// Time helpers
	function formatTime(time: number): string {
		const hours = Math.floor(time);
		const minutes = Math.floor((time % 1) * 60);
		const period = hours >= 12 ? "PM" : "AM";
		const h = hours % 12 || 12;
		return `${h}:${minutes.toString().padStart(2, "0")} ${period}`;
	}

	const skyEmoji = $derived(
		model.skyState === "night" ? "🌙" :
		model.skyState === "dawn" ? "🌅" :
		model.skyState === "dusk" ? "🌇" : "☀️"
	);

	// Group locations by type
	const cities = LOCATIONS.filter(l => l.hasBuildings);
	const nature = LOCATIONS.filter(l => !l.hasBuildings);

	// Quick time presets
	function setTime(hours: number) {
		model.syncToRealTime = false;
		model.setTime(hours);
		handleInteraction();
	}
</script>

<!-- Invisible tap target when panel is hidden -->
{#if !showPanel}
	<button class="tap-zone" onclick={openPanel} aria-label="Open settings">
		<span class="tap-hint">⚙️</span>
	</button>
{/if}

<!-- Minimal floating panel -->
{#if showPanel}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="panel" onclick={handleInteraction}>
		<header>
			<span class="status">{skyEmoji} {formatTime(model.timeOfDay)}</span>
			<button class="close" onclick={closePanel}>×</button>
		</header>

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

		<!-- Essential Controls -->
		<section class="controls-row">
			<label class="toggle">
				<input
					type="checkbox"
					checked={model.syncToRealTime}
					onchange={() => (model.syncToRealTime = !model.syncToRealTime)}
				/>
				Real Time
			</label>
			<label class="toggle">
				<input
					type="checkbox"
					checked={model.blindOpen}
					onchange={() => model.toggleBlind()}
				/>
				Blind Open
			</label>
		</section>

		<!-- Speed Control -->
		<section class="control">
			<label for="speed-slider">Speed: {model.flightSpeed.toFixed(1)}x</label>
			<input
				id="speed-slider"
				type="range"
				min="0.2"
				max="5"
				step="0.2"
				value={model.flightSpeed}
				oninput={(e) => (model.flightSpeed = parseFloat(e.currentTarget.value))}
			/>
		</section>

		<!-- Time Control -->
		<section class="control">
			<label for="time-slider">Time: {formatTime(model.syncToRealTime ? model.localTimeOfDay : model.timeOfDay)}</label>
			<input
				id="time-slider"
				type="range"
				min="0"
				max="24"
				step="0.5"
				value={model.timeOfDay}
				oninput={(e) => { model.syncToRealTime = false; model.setTime(parseFloat(e.currentTarget.value)); }}
			/>
		</section>

		<!-- Time Quick Select -->
		<section class="time-buttons">
			<button onclick={() => setTime(6.5)}>🌅 Dawn</button>
			<button onclick={() => setTime(12)}>☀️ Noon</button>
			<button onclick={() => setTime(18.5)}>🌇 Dusk</button>
			<button onclick={() => setTime(22)}>🌙 Night</button>
		</section>

		<!-- Advanced Toggle -->
		<button class="advanced-toggle" onclick={() => (showAdvanced = !showAdvanced)}>
			{showAdvanced ? "▼ Less" : "▶ More options"}
		</button>

		<!-- Advanced Controls (collapsed by default) -->
		{#if showAdvanced}
			<section class="advanced">
				<!-- Altitude Control -->
				<h4>Flight</h4>
				<div class="control">
					<label for="altitude-slider">Altitude: {(model.altitude / 1000).toFixed(0)}k ft</label>
					<input
						id="altitude-slider"
						type="range"
						min="10000"
						max="50000"
						step="1000"
						value={model.altitude}
						oninput={(e) => model.setAltitude(parseInt(e.currentTarget.value))}
					/>
				</div>

				<!-- Weather/Atmosphere -->
				<h4>Atmosphere</h4>
				<div class="control">
					<label for="weather-select">Weather</label>
					<select
						id="weather-select"
						value={model.weather}
						onchange={(e) => (model.weather = e.currentTarget.value as "clear" | "cloudy" | "overcast" | "storm")}
					>
						<option value="clear">Clear</option>
						<option value="cloudy">Cloudy</option>
						<option value="overcast">Overcast</option>
						<option value="storm">Storm</option>
					</select>
				</div>
				<div class="control">
					<label for="clouds-slider">Clouds: {(model.cloudDensity * 100).toFixed(0)}%</label>
					<input
						id="clouds-slider"
						type="range"
						min="0"
						max="1"
						step="0.1"
						value={model.cloudDensity}
						oninput={(e) => (model.cloudDensity = parseFloat(e.currentTarget.value))}
					/>
				</div>
				<div class="control">
					<label for="visibility-slider">Visibility: {model.visibility} km</label>
					<input
						id="visibility-slider"
						type="range"
						min="5"
						max="100"
						step="5"
						value={model.visibility}
						oninput={(e) => (model.visibility = parseInt(e.currentTarget.value))}
					/>
				</div>
				<div class="control">
					<label for="haze-slider">Haze: {(model.haze * 100).toFixed(0)}%</label>
					<input
						id="haze-slider"
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={model.haze}
						oninput={(e) => (model.haze = parseFloat(e.currentTarget.value))}
					/>
				</div>

				<!-- Night Mode Controls (only visible at night/dusk) -->
				{#if model.skyState === 'night' || model.skyState === 'dusk'}
					<h4>Night Mode</h4>
					<div class="control">
						<label for="night-lights-slider">City Lights: {model.nightLightIntensity.toFixed(1)}x</label>
						<input
							id="night-lights-slider"
							type="range"
							min="0.5"
							max="5"
							step="0.5"
							value={model.nightLightIntensity}
							oninput={(e) => (model.nightLightIntensity = parseFloat(e.currentTarget.value))}
						/>
					</div>
					<div class="control">
						<label for="terrain-dark-slider">Terrain Darkness: {(model.terrainDarkness * 100).toFixed(0)}%</label>
						<input
							id="terrain-dark-slider"
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={model.terrainDarkness}
							oninput={(e) => (model.terrainDarkness = parseFloat(e.currentTarget.value))}
						/>
					</div>
				{/if}

				<!-- Toggles -->
				<h4>Display</h4>
				<label class="toggle">
					<input
						type="checkbox"
						checked={model.showClouds}
						onchange={() => model.toggleClouds()}
					/>
					Show Clouds
				</label>
				<label class="toggle">
					<input
						type="checkbox"
						checked={model.showBuildings}
						onchange={() => model.toggleBuildings()}
					/>
					Show Buildings
				</label>
			</section>
		{/if}
	</div>
{/if}

<style>
	/* Tap zone - corner trigger */
	.tap-zone {
		position: fixed;
		top: 0;
		right: 0;
		width: 60px;
		height: 60px;
		background: transparent;
		border: none;
		cursor: pointer;
		z-index: 90;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.tap-hint {
		opacity: 0.3;
		font-size: 1.2rem;
		transition: opacity 0.3s;
	}

	.tap-zone:hover .tap-hint {
		opacity: 0.8;
	}

	/* Panel */
	.panel {
		position: fixed;
		top: 1rem;
		right: 1rem;
		background: rgba(0, 0, 0, 0.9);
		color: white;
		padding: 1rem;
		border-radius: 12px;
		font-size: 0.85rem;
		z-index: 100;
		width: 260px;
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		backdrop-filter: blur(10px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.15);
	}

	.status {
		font-size: 1rem;
		font-weight: 500;
	}

	.close {
		background: none;
		border: none;
		color: white;
		font-size: 1.5rem;
		cursor: pointer;
		opacity: 0.6;
		padding: 0;
		line-height: 1;
	}

	.close:hover {
		opacity: 1;
	}

	section {
		margin-bottom: 1rem;
	}

	h4 {
		margin: 0 0 0.5rem 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.5;
		font-weight: 500;
	}

	/* Location grid */
	.location-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.loc-btn {
		padding: 0.4rem 0.7rem;
		font-size: 0.75rem;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 6px;
		color: white;
		cursor: pointer;
		transition: all 0.15s;
	}

	.loc-btn:hover {
		background: rgba(255, 255, 255, 0.15);
		border-color: rgba(255, 255, 255, 0.3);
	}

	.loc-btn.active {
		background: rgba(74, 158, 255, 0.3);
		border-color: rgba(74, 158, 255, 0.6);
		color: #7bb8ff;
	}

	/* Controls row */
	.controls-row {
		display: flex;
		gap: 1rem;
		padding: 0.75rem 0;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.toggle input {
		accent-color: #4a9eff;
		width: 14px;
		height: 14px;
	}

	/* Time buttons */
	.time-buttons {
		display: flex;
		gap: 0.4rem;
	}

	.time-buttons button {
		flex: 1;
		padding: 0.5rem 0.3rem;
		font-size: 0.7rem;
		background: rgba(255, 200, 100, 0.1);
		border: 1px solid rgba(255, 200, 100, 0.3);
		border-radius: 6px;
		color: white;
		cursor: pointer;
		transition: all 0.15s;
	}

	.time-buttons button:hover {
		background: rgba(255, 200, 100, 0.2);
	}

	/* Advanced toggle */
	.advanced-toggle {
		width: 100%;
		padding: 0.5rem;
		font-size: 0.7rem;
		background: none;
		border: none;
		color: rgba(255, 255, 255, 0.5);
		cursor: pointer;
		text-align: left;
	}

	.advanced-toggle:hover {
		color: rgba(255, 255, 255, 0.8);
	}

	/* Advanced section */
	.advanced {
		padding-top: 0.5rem;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.control {
		margin-bottom: 0.75rem;
	}

	.control label {
		display: block;
		font-size: 0.7rem;
		opacity: 0.7;
		margin-bottom: 0.3rem;
	}

	.control input[type="range"] {
		width: 100%;
		accent-color: #4a9eff;
	}

	.control select {
		width: 100%;
		padding: 0.4rem;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 4px;
		color: white;
		font-size: 0.75rem;
	}

	.advanced .toggle {
		margin-top: 0.5rem;
	}

	/* Scrollbar */
	.panel::-webkit-scrollbar {
		width: 4px;
	}

	.panel::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.2);
		border-radius: 2px;
	}
</style>
