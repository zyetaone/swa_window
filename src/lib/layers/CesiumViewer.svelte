<script lang="ts">
	import { getViewerState } from '$lib/core/state.svelte';
	import { UNITS } from '$lib/core/constants';
	import type * as CesiumType from 'cesium';

	// Get viewer state
	const viewerState = getViewerState();

	// Local state
	let container: HTMLDivElement;
	let viewer: CesiumType.Viewer | null = $state(null);
	let Cesium: typeof CesiumType | null = null;
	let osmBuildings: CesiumType.Cesium3DTileset | null = null;

	// Debouncing state for performance optimization
	let lastSyncedTime: number | null = null;
	let lastCameraState: {lat: number, lon: number, alt: number, heading: number, pitch: number} | null = null;

	// Material colors for building styling
	const MATERIAL_COLORS: Record<string, string> = {
		glass: '#87ceeb', // sky blue
		brick: '#cd5c5c', // indian red
		concrete: '#808080', // grey
		metal: '#c0c0c0', // silver
		stone: '#deb887', // burlywood
		wood: '#8b4513', // saddle brown
		default: '#f5f5dc' // beige
	};

	// Sync camera position to state
	function syncCamera() {
		if (!viewer || !Cesium) return;

		const { lat, lon, altitude, heading, pitch } = viewerState;

		// Debounce: skip if position unchanged
		if (lastCameraState &&
			Math.abs(lastCameraState.lat - lat) < 0.0001 &&
			Math.abs(lastCameraState.lon - lon) < 0.0001 &&
			Math.abs(lastCameraState.alt - altitude) < 100 &&
			Math.abs(lastCameraState.heading - heading) < 0.5 &&
			Math.abs(lastCameraState.pitch - pitch) < 0.5) return;
		lastCameraState = { lat, lon, alt: altitude, heading, pitch };

		// Convert altitude from feet to meters
		const altitudeMeters = altitude * UNITS.FEET_TO_METERS;

		// SIDE WINDOW VIEW: Camera looks perpendicular to flight direction
		// Right-side window = flight heading + 90°
		// Left-side window = flight heading - 90°
		const sideWindowOffset = 90; // Right side window
		const cameraHeading = (heading + sideWindowOffset) % 360;

		// Set camera position
		viewer.camera.setView({
			destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitudeMeters),
			orientation: {
				heading: Cesium.Math.toRadians(cameraHeading),
				pitch: Cesium.Math.toRadians(pitch - 90), // Convert to Cesium's pitch convention
				roll: 0
			}
		});
	}

	// Sync time of day to Cesium clock
	function syncTime() {
		if (!viewer || !Cesium) return;

		const { timeOfDay } = viewerState;

		// Debounce: only update if time changed by > 1 minute
		if (lastSyncedTime !== null && Math.abs(timeOfDay - lastSyncedTime) < 1/60) return;
		lastSyncedTime = timeOfDay;

		// Create a JulianDate for current day at specified time
		const now = new Date();
		const currentDate = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			Math.floor(timeOfDay),
			(timeOfDay % 1) * 60
		);

		viewer.clock.currentTime = Cesium.JulianDate.fromDate(currentDate);
	}

	// Sync building visibility
	function syncBuildingVisibility() {
		if (!osmBuildings) return;
		osmBuildings.show = viewerState.showBuildings;
	}

	// Sync atmospheric visibility (fog density)
	function syncVisibility() {
		if (!viewer) return;

		// Base fog from visibility setting (5-100 km)
		const baseFogDensity = 0.00015 / (viewerState.visibility / 50);

		// Haze increases fog density subtly (0-1 range)
		// At max haze (1.0), fog is 2x denser
		const hazeMultiplier = 1 + viewerState.haze * 1;
		viewer.scene.fog.density = baseFogDensity * hazeMultiplier;

		// Haze slightly brightens shadows
		viewer.scene.fog.minimumBrightness = 0.03 + viewerState.haze * 0.08;
	}

	// Initialize Cesium viewer and handle cleanup
	$effect(() => {
		// Dynamically import Cesium to avoid SSR issues
		(async () => {
			try {
				Cesium = await import('cesium');

				// Set Cesium Ion access token
				const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
				if (cesiumToken && cesiumToken !== 'your-cesium-ion-token-here') {
					Cesium.Ion.defaultAccessToken = cesiumToken;
				} else {
					console.warn('Cesium Ion token not configured. Some features may not work. Get a free token at https://cesium.com/ion/tokens');
				}

				if (!container) return;

				// Create Cesium Viewer with minimal UI
				viewer = new Cesium.Viewer(container, {
					// Terrain
					terrain: Cesium.Terrain.fromWorldTerrain(),

					// Hide default UI widgets
					animation: false,
					baseLayerPicker: false,
					fullscreenButton: false,
					vrButton: false,
					geocoder: false,
					homeButton: false,
					infoBox: false,
					sceneModePicker: false,
					selectionIndicator: false,
					timeline: false,
					navigationHelpButton: false,
					navigationInstructionsInitiallyVisible: false,

					// Scene settings
					shadows: true,
					terrainShadows: Cesium.ShadowMode.ENABLED,
					requestRenderMode: true,
					maximumRenderTimeChange: Infinity
				});

				// Enable time-of-day lighting
				viewer.scene.globe.enableLighting = true;

				// Performance: Globe tile cache limit
				viewer.scene.globe.tileCacheSize = 300;

				// === ATMOSPHERE & REALISM ===
				// Enable atmosphere for that realistic sky gradient
				if (viewer.scene.skyAtmosphere) {
					viewer.scene.skyAtmosphere.show = true;
				}
				viewer.scene.globe.showGroundAtmosphere = true;

				// Fog for depth perception (things fade in distance)
				viewer.scene.fog.enabled = true;
				viewer.scene.fog.density = 0.0001;
				viewer.scene.fog.minimumBrightness = 0.1;

				// High dynamic range for better lighting
				viewer.scene.highDynamicRange = true;

				// Better shadow quality
				viewer.shadowMap.enabled = true;
				viewer.shadowMap.softShadows = true;
				viewer.shadowMap.size = 2048;

				// Add OSM 3D Buildings
				try {
					osmBuildings = await Cesium.createOsmBuildingsAsync();
					viewer.scene.primitives.add(osmBuildings);

					// Performance: Tile cache limits (using proper Cesium properties)
					// @ts-ignore - skipLevelOfDetail exists at runtime but may not be in type definitions
					osmBuildings.skipLevelOfDetail = true;
					// @ts-ignore - baseScreenSpaceError exists at runtime but may not be in type definitions
					osmBuildings.baseScreenSpaceError = 64;
					// @ts-ignore - maximumMemoryUsage exists at runtime but may not be in type definitions
					// Limit memory usage for 3D tiles (in MB)
					osmBuildings.maximumMemoryUsage = 128;

					// Apply building material styling
					if (osmBuildings.style) {
						osmBuildings.style = new Cesium.Cesium3DTileStyle({
							color: {
								conditions: [
									["${feature['building:material']} === 'glass'", `color('${MATERIAL_COLORS.glass}')`],
									["${feature['building:material']} === 'brick'", `color('${MATERIAL_COLORS.brick}')`],
									["${feature['building:material']} === 'concrete'", `color('${MATERIAL_COLORS.concrete}')`],
									["${feature['building:material']} === 'metal'", `color('${MATERIAL_COLORS.metal}')`],
									["${feature['building:material']} === 'stone'", `color('${MATERIAL_COLORS.stone}')`],
									["${feature['building:material']} === 'wood'", `color('${MATERIAL_COLORS.wood}')`],
									['true', `color('${MATERIAL_COLORS.default}')`]
								]
							}
						});
					}
				} catch (error) {
					console.error('Failed to load OSM buildings:', error);
				}

				// Initial camera sync
				syncCamera();
			} catch (error) {
				console.error('Failed to initialize Cesium:', error);
			}
		})();

		// Cleanup function
		return () => {
			if (viewer && !viewer.isDestroyed()) {
				viewer.destroy();
			}
			viewer = null;
			Cesium = null;
			osmBuildings = null;
		};
	});

	// Consolidated effect for all viewer state changes
	$effect(() => {
		if (!viewer || !Cesium) return;

		// Track all dependencies
		const { lat, lon, altitude, heading, pitch, timeOfDay, visibility, haze, showBuildings } = viewerState;

		syncCamera();
		syncTime();
		syncBuildingVisibility();
		syncVisibility();

		// Single render request
		viewer.scene.requestRender();
	});
</script>

<div
	bind:this={container}
	class="cesium-container"
></div>

<style>
	.cesium-container {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.cesium-container :global(.cesium-viewer) {
		width: 100% !important;
		height: 100% !important;
	}

	.cesium-container :global(.cesium-viewer-cesiumWidgetContainer) {
		width: 100% !important;
		height: 100% !important;
	}

	.cesium-container :global(.cesium-widget) {
		width: 100% !important;
		height: 100% !important;
	}

	.cesium-container :global(.cesium-widget canvas) {
		width: 100% !important;
		height: 100% !important;
	}

	.cesium-container :global(.cesium-viewer-bottom) {
		display: none !important;
	}

	.cesium-container :global(.cesium-viewer-toolbar) {
		display: none !important;
	}

	.cesium-container :global(.cesium-credit-textContainer) {
		display: none !important;
	}

	.cesium-container :global(.cesium-credit-logoContainer) {
		display: none !important;
	}
</style>
