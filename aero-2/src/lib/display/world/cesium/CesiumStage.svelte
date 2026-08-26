<script lang="ts">
	/**
	 * CesiumStage — Modular 3D Globe Renderer orchestrating Cesium subsystems:
	 * 1. imagery.ts    — Sentinel-2, GIBS & VIIRS layers
	 * 2. camera.ts     — WGS84 Camera positioning
	 * 3. atmosphere.ts — Sky atmosphere & globe lighting
	 *
	 * EXPERIMENTAL, and not shippable as it stands. Reached only via
	 * `?engine=cesium`; the kiosk default is MapLibre.
	 *
	 * Two things are missing, and both fail at RUNTIME rather than at build:
	 *
	 * 1. `cesium` is not in package.json. It is present in node_modules on this
	 *    machine but absent from the lockfile, so a clean install does not have
	 *    it. The build still succeeds, because `import('cesium')` is dynamic —
	 *    which is exactly why this cannot be caught by `bun run build`.
	 *
	 * 2. `static/cesiumStatic` does not exist. ADR-005 deleted it (8.9 MB of
	 *    assets) when Cesium was removed. Without it the viewer 404s on every
	 *    widget image it asks for.
	 *
	 * Measured on `?engine=cesium`: 1 uncaught exception and 10 404s against
	 *   /cesiumStatic/*. The error boundary catches it, so the cabin survives,
	 *   but there is no globe.
	 *
	 * To make this real: add cesium to package.json (~144 MB in node_modules),
	 * restore the static asset copy step, and re-run the ADR-005 comparison —
	 * that decision was made on bundle size and Pi 5 headroom, and reversing it
	 * should be a measurement, not a drive-by.
	 */
	import { useDisplay } from '../../display.svelte.js';
	import { setupCesiumImagery } from './imagery.js';
	import { syncCesiumCamera } from './camera.js';
	import { setupCesiumAtmosphere } from './atmosphere.js';

	const display = useDisplay();
	let container = $state<HTMLDivElement | undefined>();

	$effect(() => {
		if (!container) return;

		let viewer: any = null;
		let destroyed = false;

		// Dynamic import keeps Cesium chunk code-split
		import('cesium')
			.then((Cesium) => {
				if (destroyed || !container) return;

				if (typeof window !== 'undefined' && !(window as any).CESIUM_BASE_URL) {
					(window as any).CESIUM_BASE_URL = '/cesiumStatic';
				}

				viewer = new Cesium.Viewer(container, {
					animation: false,
					baseLayerPicker: false,
					fullscreenButton: false,
					geocoder: false,
					homeButton: false,
					infoBox: false,
					sceneModePicker: false,
					selectionIndicator: false,
					timeline: false,
					navigationHelpButton: false,
					navigationInstructionsInitiallyVisible: false,
					sceneMode: Cesium.SceneMode.SCENE3D,
					requestRenderMode: false
				});

				const imagery = setupCesiumImagery(Cesium, viewer, display.config.cesiumProvider);
				setupCesiumAtmosphere(Cesium, viewer, {
					enableLighting: display.config.cesiumLighting,
					showAtmosphere: display.config.cesiumAtmosphere
				});

				const removeListener = viewer.scene.preRender.addEventListener(() => {
					imagery.setNightAlpha(display.night * display.config.cesiumViirsBrightness);
					syncCesiumCamera(Cesium, viewer, display.view);
				});

				return () => {
					removeListener();
				};
			})
			.catch((err) => {
				console.warn('[CesiumStage] Dynamic Cesium load error:', err);
			});

		return () => {
			destroyed = true;
			if (viewer && !viewer.isDestroyed()) {
				viewer.destroy();
			}
		};
	});
</script>

<div bind:this={container} class="cesium-stage-container" aria-hidden="true"></div>

<style>
	.cesium-stage-container {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: #0b101b;
		overflow: hidden;
		z-index: 0;
	}

	.cesium-stage-container :global(.cesium-viewer),
	.cesium-stage-container :global(.cesium-viewer-cesiumWidgetContainer),
	.cesium-stage-container :global(.cesium-widget) {
		width: 100% !important;
		height: 100% !important;
		position: absolute !important;
		inset: 0 !important;
	}

	.cesium-stage-container :global(canvas) {
		width: 100% !important;
		height: 100% !important;
		position: absolute !important;
		top: 0 !important;
		left: 0 !important;
	}

	.cesium-stage-container :global(.cesium-viewer-bottom),
	.cesium-stage-container :global(.cesium-viewer-toolbar),
	.cesium-stage-container :global(.cesium-credit-textContainer),
	.cesium-stage-container :global(.cesium-credit-logoContainer) {
		display: none !important;
	}
</style>
