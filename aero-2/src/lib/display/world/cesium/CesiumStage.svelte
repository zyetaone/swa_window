<script lang="ts">
	/**
	 * CesiumStage — Modular 3D Globe Renderer orchestrating Cesium subsystems:
	 * 1. imagery.ts    — Sentinel-2, GIBS & VIIRS layers
	 * 2. camera.ts     — WGS84 Camera positioning with MSL ground elevation offset
	 * 3. atmosphere.ts — Sky atmosphere & globe lighting
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

				// Lock camera to aircraft flight controls
				const controller = viewer.scene.screenSpaceCameraController;
				controller.enableRotate = false;
				controller.enableTranslate = false;
				controller.enableZoom = false;
				controller.enableTilt = false;
				controller.enableLook = false;

				const imagery = setupCesiumImagery(Cesium, viewer, display.config.cesiumProvider);
				setupCesiumAtmosphere(Cesium, viewer, {
					enableLighting: display.config.cesiumLighting,
					showAtmosphere: display.config.cesiumAtmosphere
				});

				const removeListener = viewer.scene.preRender.addEventListener(() => {
					imagery.setNightAlpha(display.night * display.config.cesiumViirsBrightness);
					const groundElev = display.config.place?.groundElevationM ?? 0;
					syncCesiumCamera(Cesium, viewer, display.view, groundElev, (ok) =>
						display.noteClearance(ok)
					);
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
