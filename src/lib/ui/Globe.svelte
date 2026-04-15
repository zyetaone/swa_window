<script lang="ts">
	/**
	 * CesiumViewer — thin shell for CesiumManager.
	 *
	 * All Cesium logic lives in CesiumManager (terrain, imagery, camera,
	 * atmosphere, buildings, post-processing). This component handles:
	 *   - Loading overlay + error + retry UI
	 *   - Container mount/unmount lifecycle
	 *   - Reactive effects that call CesiumManager methods
	 */
	import { onMount, onDestroy } from 'svelte';
	import { useAppState } from '$lib/app-state.svelte';
	import { CesiumManager } from '$lib/cesium/manager';
	import { COLOR_GRADING_GLSL } from '$lib/cesium/shaders';
	import { initCesiumGlobal } from '$lib/cesium/config';
	import { activeCesium } from '$lib/cesium/active.svelte';

	const model = useAppState();

	// ─── Cesium lifecycle ────────────────────────────────────────────────────

	let cesium: CesiumManager | null = null;
	let loading = $state(true);
	let fadingOut = $state(false);
	let error = $state<string | null>(null);
	let viewerContainer: HTMLDivElement;
	let loadTimeout: ReturnType<typeof setTimeout> | null = null;

	onMount(async () => {
		try {
			const CesiumModule = await import('cesium');
			initCesiumGlobal(CesiumModule);

			cesium = new CesiumManager(model, CesiumModule, viewerContainer);
			await cesium.start(COLOR_GRADING_GLSL);
			activeCesium.manager = cesium;

			fadingOut = true;
			loadTimeout = setTimeout(() => {
				loading = false;
				fadingOut = false;
			}, 600);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error';
			loading = false;
		}
	});

	onDestroy(() => {
		if (loadTimeout) clearTimeout(loadTimeout);
		activeCesium.manager = null;
		cesium?.destroy();
		cesium = null;
	});

	// ─── Reactive effects ─────────────────────────────────────────────────────

	$effect(() => {
		if (!cesium) return;
		cesium.applyQualityMode(model.qualityMode);
	});
</script>

<div class="cesium-container">
	<div bind:this={viewerContainer} class="cesium-viewer"></div>

	{#if loading}
		<div
			class="loading-overlay"
			class:fade-out={fadingOut}
			ontransitionend={() => {
				loading = false;
				fadingOut = false;
			}}
		>
			<div class="loading-content">
				<svg class="loading-plane" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
					<path d="M32 8 L28 28 L8 36 L28 34 L26 52 L32 48 L38 52 L36 34 L56 36 L36 28 Z" fill="currentColor"/>
				</svg>
				<span class="loading-text">Loading terrain</span>
			</div>
		</div>
	{/if}

	{#if error}
		<div class="error-overlay">
			<div class="error-content">
				<div class="error-icon">
					<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="32" height="32">
						<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/>
					</svg>
				</div>
				<p class="error-message">Unable to load terrain</p>
				<p class="error-detail">{error}</p>
				<button
					class="error-retry"
					onclick={() => window.location.reload()}
				>
					Retry
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.cesium-container {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.cesium-viewer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	/* Cesium creates its own nested .cesium-viewer / .cesium-widget divs inside
	   our container. We don't ship widgets.css, so we have to size them ourselves
	   or they collapse to 0×0 and the canvas renders nothing visible. */
	.cesium-viewer :global(.cesium-viewer),
	.cesium-viewer :global(.cesium-viewer-cesiumWidgetContainer),
	.cesium-viewer :global(.cesium-widget) {
		width: 100% !important;
		height: 100% !important;
		position: absolute !important;
		inset: 0 !important;
	}

	.cesium-viewer :global(canvas) {
		width: 100% !important;
		height: 100% !important;
		position: absolute !important;
		top: 0 !important;
		left: 0 !important;
	}

	.cesium-viewer :global(.cesium-viewer-bottom),
	.cesium-viewer :global(.cesium-viewer-toolbar),
	.cesium-viewer :global(.cesium-credit-textContainer),
	.cesium-viewer :global(.cesium-credit-logoContainer) {
		display: none !important;
	}

	/* --- Loading overlay --- */

	.loading-overlay {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(5 5 10 / 0.98);
		transition: opacity 0.6s ease;
	}

	.loading-overlay.fade-out {
		opacity: 0;
		pointer-events: none;
	}

	.loading-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.loading-plane {
		width: 48px;
		height: 48px;
		color: rgb(255 255 255 / 0.5);
		animation: loading-pulse 2s ease-in-out infinite;
	}

	.loading-text {
		color: rgb(255 255 255 / 0.4);
		font-size: 0.8rem;
		font-family: system-ui, -apple-system, sans-serif;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		animation: loading-text-fade 2s ease-in-out infinite;
	}

	@keyframes loading-pulse {
		0%, 100% { opacity: 0.3; transform: scale(0.95); }
		50% { opacity: 0.7; transform: scale(1.05); }
	}

	@keyframes loading-text-fade {
		0%, 100% { opacity: 0.3; }
		50% { opacity: 0.6; }
	}

	/* --- Error overlay --- */

	.error-overlay {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(5 5 10 / 0.95);
	}

	.error-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 2.5rem;
		border: 1px solid rgb(255 255 255 / 0.08);
		border-radius: 12px;
		background: rgb(255 255 255 / 0.03);
	}

	.error-icon {
		color: rgb(255 255 255 / 0.3);
	}

	.error-message {
		color: rgb(255 255 255 / 0.7);
		font-size: 0.95rem;
		font-family: system-ui, -apple-system, sans-serif;
		margin: 0;
	}

	.error-detail {
		color: rgb(255 255 255 / 0.3);
		font-size: 0.7rem;
		font-family: monospace;
		margin: 0;
		max-width: 300px;
		text-align: center;
		word-break: break-all;
	}

	.error-retry {
		margin-top: 0.5rem;
		padding: 0.5rem 1.5rem;
		background: rgba(48, 76, 178, 0.4);
		border: 1px solid rgba(48, 76, 178, 0.6);
		border-radius: 6px;
		color: rgb(200 210 255);
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.2s ease;
	}

	.error-retry:hover {
		background: rgba(48, 76, 178, 0.6);
	}
</style>
