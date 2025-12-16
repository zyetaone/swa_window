<script lang="ts">
	/**
	 * Window Component - Realistic airplane window
	 *
	 * Layering (back to front):
	 * 1. Cesium terrain/buildings (base)
	 * 2. Three.js overlay (wing, clouds)
	 * 3. Glass effects (frost at altitude)
	 * 4. Frame border
	 */

	import {
		getViewerState,
		LOCATIONS,
	} from "$lib/core/state.svelte";
	import CesiumViewer from "./CesiumViewer.svelte";
	import Scene3DOverlay from "./Scene3DOverlay.svelte";

	const viewer = getViewerState();

	// Track current location index for cycling
	let locationIndex = $state(0);

	// Close blind and switch to next city
	function closeBlindAndSwitchCity() {
		if (viewer.blindOpen) {
			viewer.blindOpen = false;
			setTimeout(() => {
				locationIndex = (locationIndex + 1) % LOCATIONS.length;
				const nextLocation = LOCATIONS[locationIndex];
				viewer.setLocation(nextLocation.id);
			}, 300);
		}
	}

	// Open blind
	function openBlind() {
		if (!viewer.blindOpen) {
			viewer.blindOpen = true;
		}
	}

	// Frost at high altitude (above 25,000 ft)
	const frostAmount = $derived(
		Math.max(0, Math.min(1, (viewer.altitude - 25000) / 15000))
	);

	// Atmospheric haze overlay (works with Cesium fog)
	const hazeOpacity = $derived(viewer.haze * 0.12);

	// Combined filter: brightness + contrast + slight desaturation for haze
	const filterString = $derived.by(() => {
		const timeBrightness = viewer.skyState === "night" ? 0.85 :
			viewer.skyState === "dawn" || viewer.skyState === "dusk" ? 0.92 : 1.0;
		const weatherBrightness = viewer.weather === "storm" ? 0.9 :
			viewer.weather === "overcast" ? 0.95 : 1.0;
		const hazeContrast = 1 - viewer.haze * 0.08;
		const hazeSaturate = 1 - viewer.haze * 0.1;

		const brightness = timeBrightness * weatherBrightness;
		return `brightness(${brightness.toFixed(2)}) contrast(${hazeContrast.toFixed(2)}) saturate(${hazeSaturate.toFixed(2)})`;
	});

	// Sun glare position (subtle circular glow)
	const sunVisible = $derived(
		viewer.skyState === "day" || viewer.skyState === "dawn" || viewer.skyState === "dusk"
	);
	const sunGlareX = $derived(50 + Math.sin(((viewer.timeOfDay - 6) / 12) * Math.PI) * 25);
	const sunGlareY = $derived(35 - Math.cos(((viewer.timeOfDay - 6) / 12) * Math.PI) * 20);
	const sunGlareOpacity = $derived(
		viewer.skyState === "day" ? 0.12 :
		viewer.skyState === "dawn" || viewer.skyState === "dusk" ? 0.2 : 0
	);
</script>

<div class="window-container">
	<!-- The oval window -->
	<button
		class="window-viewport"
		onclick={closeBlindAndSwitchCity}
		type="button"
		aria-label="Close blind and fly to next city"
		style:filter={filterString}
	>
		<!-- Cesium terrain/buildings -->
		<div class="render-layer">
			<CesiumViewer />
		</div>

		<!-- Three.js overlay (wing, clouds) -->
		<div class="render-layer">
			<Scene3DOverlay />
		</div>

		<!-- Frost at high altitude (subtle) -->
		{#if frostAmount > 0}
			<div class="frost-layer" style:opacity={frostAmount * 0.3}></div>
		{/if}

		<!-- Atmospheric haze overlay -->
		{#if hazeOpacity > 0}
			<div class="haze-overlay" style:opacity={hazeOpacity}></div>
		{/if}

		<!-- Sun glare (subtle) -->
		{#if sunVisible && sunGlareOpacity > 0}
			<div
				class="sun-glare"
				style:left="{sunGlareX}%"
				style:top="{sunGlareY}%"
				style:opacity={sunGlareOpacity}
			></div>
		{/if}

		<!-- Vignette -->
		<div class="vignette"></div>

		<!-- Click hint -->
		{#if viewer.blindOpen}
			<div class="click-hint">
				<span>Click to visit {LOCATIONS[(locationIndex + 1) % LOCATIONS.length].name}</span>
			</div>
		{/if}
	</button>

	<!-- Window frame -->
	<div class="window-frame"></div>

	<!-- Blind -->
	<div class="blind-clip">
		<button
			class="blind-overlay"
			class:open={viewer.blindOpen}
			onclick={openBlind}
			type="button"
			aria-label="Open window blind"
		>
			<div class="blind-slats"></div>
			<span class="blind-label">Click to open</span>
		</button>
	</div>
</div>

<style>
	.window-container {
		position: relative;
		width: min(50vw, 60vh);
		height: min(75vh, 85vw);
		margin: auto;
	}

	.window-viewport {
		position: absolute;
		inset: 15px;
		border-radius: 45%;
		overflow: hidden;
		background: #1a1a2e;
		border: none;
		padding: 0;
		cursor: pointer;
		transition: filter 0.5s;
	}

	.window-viewport:hover {
		filter: brightness(1.02);
	}

	.render-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.render-layer > :global(*) {
		position: absolute !important;
		inset: 0 !important;
		width: 100% !important;
		height: 100% !important;
	}

	.window-frame {
		position: absolute;
		inset: 0;
		border-radius: 45%;
		border: 15px solid #e0dcd8;
		pointer-events: none;
		z-index: 10;
		box-shadow:
			inset 0 2px 10px rgba(0, 0, 0, 0.2),
			inset 0 -2px 5px rgba(255, 255, 255, 0.3),
			0 5px 20px rgba(0, 0, 0, 0.3);
	}

	.blind-clip {
		position: absolute;
		inset: 15px;
		border-radius: 45%;
		overflow: hidden;
		z-index: 5;
		pointer-events: none;
	}

	.blind-overlay {
		position: absolute;
		inset: 0;
		border-radius: 45%;
		background: rgba(240, 238, 235, 0.95);
		backdrop-filter: blur(5px);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		padding: 0;
		pointer-events: auto;
		transform: translateY(0);
		transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.blind-overlay.open {
		transform: translateY(-105%);
		pointer-events: none;
	}

	.blind-slats {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			180deg,
			rgba(230, 228, 225, 0.9) 0px,
			rgba(230, 228, 225, 0.9) 6px,
			rgba(210, 208, 205, 0.7) 6px,
			rgba(210, 208, 205, 0.7) 8px
		);
		box-shadow: inset 0 -20px 30px rgba(0, 0, 0, 0.1);
	}

	.blind-overlay::after {
		content: "";
		position: absolute;
		bottom: 8%;
		left: 30%;
		right: 30%;
		height: 8px;
		background: linear-gradient(180deg, #b0a8a0 0%, #908880 100%);
		border-radius: 4px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
	}

	.blind-label {
		position: relative;
		z-index: 1;
		color: #666;
		font-size: 14px;
		background: rgba(255, 255, 255, 0.8);
		padding: 8px 16px;
		border-radius: 20px;
	}

	.blind-overlay.open .blind-label {
		opacity: 0;
	}

	.frost-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 5;
		background: radial-gradient(
			ellipse 100% 100% at 50% 50%,
			transparent 40%,
			rgba(200, 220, 255, 0.4) 70%,
			rgba(180, 200, 255, 0.6) 90%
		);
		backdrop-filter: blur(1px);
	}

	.haze-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 3;
		background: linear-gradient(
			180deg,
			rgba(180, 200, 220, 0.8) 0%,
			rgba(200, 210, 220, 0.6) 50%,
			rgba(180, 190, 200, 0.4) 100%
		);
	}

	.sun-glare {
		position: absolute;
		width: 120px;
		height: 120px;
		pointer-events: none;
		z-index: 4;
		transform: translate(-50%, -50%);
		background: radial-gradient(
			circle at center,
			rgba(255, 255, 220, 0.6) 0%,
			rgba(255, 250, 200, 0.3) 30%,
			rgba(255, 220, 150, 0.1) 50%,
			transparent 70%
		);
		filter: blur(15px);
	}

	.vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 6;
		background: radial-gradient(
			ellipse 75% 65% at 50% 50%,
			transparent 55%,
			rgba(0, 0, 0, 0.08) 80%,
			rgba(0, 0, 0, 0.15) 100%
		);
	}

	.click-hint {
		position: absolute;
		bottom: 10%;
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.3s;
	}

	.window-viewport:hover .click-hint {
		opacity: 1;
	}

	.click-hint span {
		background: rgba(0, 0, 0, 0.7);
		color: white;
		padding: 8px 16px;
		border-radius: 20px;
		font-size: 12px;
		white-space: nowrap;
		backdrop-filter: blur(5px);
	}
</style>
