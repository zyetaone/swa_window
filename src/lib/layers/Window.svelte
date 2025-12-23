<script lang="ts">
	/**
	 * Window Component - Simplified to use model.flyTo()
	 *
	 * All flight transition logic is now in WindowModel
	 */
	import { useAppState, LOCATIONS, BLIND } from "$lib/core";
	import CesiumViewer from "./CesiumViewer.svelte";
	import Scene3DOverlay from "./Scene3DOverlay.svelte";

	const { model } = useAppState();

	let locationIndex = $state(0);
	let autoCycleEnabled = $state(true);

	function handleBlindClick() {
		if (model.isTransitioning) return;
		model.blindOpen = true;
	}

	async function handleWindowClick() {
		if (model.isTransitioning) return;
		const nextIndex = (locationIndex + 1) % LOCATIONS.length;
		locationIndex = nextIndex;
		const nextLoc = LOCATIONS[nextIndex];
		if (nextLoc) await model.flyTo(nextLoc.id);
	}

	// Auto-cycle
	$effect(() => {
		if (!autoCycleEnabled) return;
		const interval = setInterval(() => {
			if (!model.isTransitioning && model.blindOpen) {
				handleWindowClick();
			}
		}, BLIND.AUTO_CYCLE_INTERVAL);
		return () => clearInterval(interval);
	});

	// Derived values from model
	const frostRange = BLIND.FROST_MAX_ALTITUDE - BLIND.FROST_START_ALTITUDE;
	const frostAmount = $derived(Math.max(0, Math.min(1, (model.altitude - BLIND.FROST_START_ALTITUDE) / frostRange)));
	const hazeOpacity = $derived(model.haze * 0.12);

	const filterString = $derived.by(() => {
		const timeBrightness = model.skyState === "night" ? 0.85 :
			model.skyState === "dawn" || model.skyState === "dusk" ? 0.92 : 1.0;
		const weatherBrightness = model.weather === "storm" ? 0.9 :
			model.weather === "overcast" ? 0.95 : 1.0;
		const hazeContrast = 1 - model.haze * 0.08;
		const hazeSaturate = 1 - model.haze * 0.1;
		const brightness = timeBrightness * weatherBrightness;
		return `brightness(${brightness.toFixed(2)}) contrast(${hazeContrast.toFixed(2)}) saturate(${hazeSaturate.toFixed(2)})`;
	});

	const sunVisible = $derived(model.skyState === "day" || model.skyState === "dawn" || model.skyState === "dusk");
	const sunGlareX = $derived(50 + Math.sin(((model.timeOfDay - 6) / 12) * Math.PI) * 25);
	const sunGlareY = $derived(35 - Math.cos(((model.timeOfDay - 6) / 12) * Math.PI) * 20);
	const sunGlareOpacity = $derived(model.skyState === "day" ? 0.12 : model.skyState === "dawn" || model.skyState === "dusk" ? 0.2 : 0);

	const nextLocation = $derived(LOCATIONS[(locationIndex + 1) % Math.max(LOCATIONS.length, 1)]);
</script>

<div class="window-container">
	<!-- The oval window -->
	<button
		class="window-viewport"
		onclick={handleWindowClick}
		type="button"
		aria-label="Close blind and fly to next city"
		style:filter={filterString}
		disabled={model.isTransitioning}
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
		{#if model.blindOpen && !model.isTransitioning && nextLocation}
			<div class="click-hint">
				<span>Click to visit {nextLocation.name}</span>
			</div>
		{/if}

		<!-- Transition status -->
		{#if model.isTransitioning && model.transitionDestination}
			<div class="transition-status">
				<span>Flying to {model.transitionDestination}...</span>
			</div>
		{/if}
	</button>

	<!-- Window frame -->
	<div class="window-frame"></div>

	<!-- Blind -->
	<div class="blind-clip">
		<button
			class="blind-overlay"
			class:open={model.blindOpen}
			onclick={handleBlindClick}
			type="button"
			aria-label="Open window blind"
			disabled={model.isTransitioning}
		>
			<div class="blind-slats"></div>
			<span class="blind-label">{model.isTransitioning ? 'In flight...' : 'Click to open'}</span>
		</button>
	</div>
</div>

<style>
	.window-container {
		position: relative;
		/* Wider airplane window - 3:4 aspect ratio */
		width: min(90vw, 70vh);
		aspect-ratio: 3 / 4;
		margin: auto;
		max-height: 90vh;
	}

	/* Portrait orientation */
	@media (orientation: portrait) {
		.window-container {
			width: min(88vw, 75vh);
			max-height: 88vh;
		}
	}

	/* Landscape orientation */
	@media (orientation: landscape) {
		.window-container {
			width: auto;
			height: min(88vh, 65vw);
			aspect-ratio: 3 / 4;
		}
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

	.window-viewport:hover:not(:disabled) {
		filter: brightness(1.02);
	}

	.window-viewport:disabled {
		cursor: not-allowed;
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

	.blind-overlay:disabled {
		cursor: not-allowed;
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
		transition: opacity 0.3s;
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

	.transition-status {
		position: absolute;
		top: 10%;
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		pointer-events: none;
		animation: pulse 2s ease-in-out infinite;
	}

	.transition-status span {
		background: rgba(0, 0, 0, 0.85);
		color: white;
		padding: 12px 24px;
		border-radius: 25px;
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
		backdrop-filter: blur(10px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.8;
		}
	}
</style>
