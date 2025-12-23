<script lang="ts">
	/**
	 * CesiumViewer.svelte - Terrain and Building Rendering
	 *
	 * Coordinate Systems:
	 * - Cesium uses ECEF (Earth-Centered, Earth-Fixed) internally
	 * - Camera positioning uses: lon (degrees, -180 to 180), lat (degrees, -90 to 90), altitude (meters)
	 * - Camera orientation: heading (degrees, 0=N, 90=E), pitch (degrees, -90=down, 90=up), roll (degrees)
	 * - Pitch conversion: Three.js uses horizon-relative, Cesium uses zenith-relative
	 *   - Cesium pitch 0 = looking at zenith (straight up)
	 *   - Cesium pitch -90 = looking at horizon
	 *   - Our model.pitch (75° looking down) converts to: pitch - 90 + 75 = -15° in Cesium
	 *
	 * Side Window View:
	 * - Right-side window = flight heading + 90°
	 * - Left-side window = flight heading - 90°
	 */
import { useAppState } from '$lib/core';
import { UNITS } from '$lib/core/constants';
import type * as CesiumType from 'cesium';

	// Get viewer state
	const { model: viewerState } = useAppState();

	// ============================================
	// HMR-SAFE: Module-level cache for Cesium viewer
	// These persist across hot module reloads
	// ============================================
	interface CesiumHMRCache {
		viewer: CesiumType.Viewer | null;
		Cesium: typeof CesiumType | null;
		osmBuildings: CesiumType.Cesium3DTileset | null;
		nightImageryLayer: CesiumType.ImageryLayer | null;
		dayImageryLayer: CesiumType.ImageryLayer | null;
		initialized: boolean;
	}

	// Use a typed global cache
	const globalAny = globalThis as unknown as { __CESIUM_HMR_CACHE__?: CesiumHMRCache };
	if (!globalAny.__CESIUM_HMR_CACHE__) {
		globalAny.__CESIUM_HMR_CACHE__ = {
			viewer: null,
			Cesium: null,
			osmBuildings: null,
			nightImageryLayer: null,
			dayImageryLayer: null,
			initialized: false
		};
	}
	const HMR_CACHE = globalAny.__CESIUM_HMR_CACHE__;

	// Local state (component-level)
	let container: HTMLDivElement;
	let viewer = $state<CesiumType.Viewer | null>(HMR_CACHE.viewer);
	let Cesium: typeof CesiumType | null = HMR_CACHE.Cesium;
	let osmBuildings: CesiumType.Cesium3DTileset | null = HMR_CACHE.osmBuildings;
	let nightImageryLayer: CesiumType.ImageryLayer | null = HMR_CACHE.nightImageryLayer;
	let dayImageryLayer: CesiumType.ImageryLayer | null = HMR_CACHE.dayImageryLayer;

	// Debouncing state for performance optimization
	let lastSyncedTime: number | null = null;
	let lastCameraState: {lat: number, lon: number, alt: number, heading: number, pitch: number} | null = null;
	let lastSkyState: string | null = null;

	// Material colors for building styling (day)
	const MATERIAL_COLORS: Record<string, string> = {
		glass: '#87ceeb', // sky blue
		brick: '#cd5c5c', // indian red
		concrete: '#808080', // grey
		metal: '#c0c0c0', // silver
		stone: '#deb887', // burlywood
		wood: '#8b4513', // saddle brown
		default: '#f5f5dc' // beige
	};

	// Night colors - warm glow for lit buildings
	const NIGHT_EMISSIVE_COLORS: Record<string, string> = {
		glass: '#ffd580', // warm amber for lit glass buildings
		brick: '#ff9966', // warm orange for lit brick
		concrete: '#ffcc99', // soft warm white for concrete
		metal: '#ffffcc', // bright warm white for metal
		stone: '#ffb366', // warm amber for stone
		wood: '#ff8833', // warm orange for wood
		default: '#ffaa55' // warm yellow-orange default
	};

	// Sync camera position to state
	function syncCamera() {
		if (!viewer || !Cesium) return;

		const { lat, lon, altitude, heading, pitch } = viewerState;

		// Debounce: skip if position unchanged
		// Thresholds lowered to allow smooth flight drift movement
		if (lastCameraState &&
			Math.abs(lastCameraState.lat - lat) < 0.00001 &&
			Math.abs(lastCameraState.lon - lon) < 0.00001 &&
			Math.abs(lastCameraState.alt - altitude) < 10 &&
			Math.abs(lastCameraState.heading - heading) < 0.1 &&
			Math.abs(lastCameraState.pitch - pitch) < 0.1) return;

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

	// Sync building style based on time of day
	function syncBuildingStyle() {
		if (!osmBuildings || !Cesium) return;

		const isNight = viewerState.skyState === 'night' || viewerState.skyState === 'dusk';

		// Night: emissive colors for lit buildings
		if (isNight) {
			osmBuildings.style = new Cesium.Cesium3DTileStyle({
				color: {
					conditions: [
						["${feature['building:material']} === 'glass'", `color('${NIGHT_EMISSIVE_COLORS.glass}')`],
						["${feature['building:material']} === 'brick'", `color('${NIGHT_EMISSIVE_COLORS.brick}')`],
						["${feature['building:material']} === 'concrete'", `color('${NIGHT_EMISSIVE_COLORS.concrete}')`],
						["${feature['building:material']} === 'metal'", `color('${NIGHT_EMISSIVE_COLORS.metal}')`],
						["${feature['building:material']} === 'stone'", `color('${NIGHT_EMISSIVE_COLORS.stone}')`],
						["${feature['building:material']} === 'wood'", `color('${NIGHT_EMISSIVE_COLORS.wood}')`],
						['true', `color('${NIGHT_EMISSIVE_COLORS.default}')`]
					]
				}
			});
		}
		// Day: normal material colors
		else {
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
	}

	// Calculate night lights opacity based on altitude
	// At cruising altitude (10k-30k ft): 15-20% opacity (subtle overlay)
	// Above 30k ft: fades out gradually
	// Above 60k ft: nearly invisible (space view)
	function getNightLightsOpacity(altitudeFt: number): number {
		const MIN_ALT = 10000;   // Start showing lights
		const PEAK_ALT = 25000;  // Maximum visibility
		const FADE_ALT = 40000;  // Start fading
		const MAX_ALT = 60000;   // Nearly invisible

		const BASE_OPACITY = 0.15; // 15% base opacity
		const PEAK_OPACITY = 0.20; // 20% max at optimal altitude

		if (altitudeFt < MIN_ALT) {
			// Below 10k: fade in (too close to ground)
			return BASE_OPACITY * (altitudeFt / MIN_ALT);
		} else if (altitudeFt < PEAK_ALT) {
			// 10k-25k: ramp up to peak
			const t = (altitudeFt - MIN_ALT) / (PEAK_ALT - MIN_ALT);
			return BASE_OPACITY + (PEAK_OPACITY - BASE_OPACITY) * t;
		} else if (altitudeFt < FADE_ALT) {
			// 25k-40k: hold at peak
			return PEAK_OPACITY;
		} else if (altitudeFt < MAX_ALT) {
			// 40k-60k: fade out
			const t = (altitudeFt - FADE_ALT) / (MAX_ALT - FADE_ALT);
			return PEAK_OPACITY * (1 - t);
		} else {
			// Above 60k: nearly invisible
			return 0.02;
		}
	}

	// Switch imagery layers between day and night with darkening effect
	function syncImageryLayer() {
		if (!viewer || !Cesium || !dayImageryLayer) {
			if (import.meta.env.DEV) console.log('syncImageryLayer skipped - missing refs');
			return;
		}

		const skyState = viewerState.skyState;
		const altitudeFt = viewerState.altitude;

		// Calculate altitude-based opacity for night lights
		const altitudeOpacity = getNightLightsOpacity(altitudeFt);

		// Night: Dark terrain + subtle city lights overlay (altitude-based)
		if (skyState === 'night') {
			const darkness = viewerState.terrainDarkness;

			// Make terrain imagery dark based on terrainDarkness
			dayImageryLayer.brightness = 1.0 - (darkness * 0.98);
			dayImageryLayer.contrast = 1.0 - (darkness * 0.5);
			dayImageryLayer.saturation = 1.0 - (darkness * 0.9);
			dayImageryLayer.gamma = 1.0 + (darkness * 2.0);
			dayImageryLayer.alpha = 1.0;

			// Night lights as subtle overlay - opacity based on altitude
			if (nightImageryLayer) {
				nightImageryLayer.alpha = altitudeOpacity;
				nightImageryLayer.brightness = 2.5; // Boost brightness since opacity is low
				nightImageryLayer.contrast = 1.5;
				nightImageryLayer.gamma = 0.8;
			}

			// Reduce atmosphere glow at night
			if (viewer.scene.skyAtmosphere) {
				viewer.scene.skyAtmosphere.brightnessShift = -0.5;
				viewer.scene.skyAtmosphere.saturationShift = -0.3;
			}
			viewer.scene.globe.showGroundAtmosphere = false;

			// Darken the globe's base color for night
			const baseColorValue = Math.floor((1 - darkness) * 30);
			viewer.scene.globe.baseColor = Cesium.Color.fromBytes(baseColorValue, baseColorValue, baseColorValue + 10, 255);

		}
		// Dusk: Transitioning to night
		else if (skyState === 'dusk') {
			dayImageryLayer.brightness = 0.25;
			dayImageryLayer.contrast = 1.0;
			dayImageryLayer.saturation = 0.5;
			dayImageryLayer.gamma = 1.5;
			dayImageryLayer.alpha = 1.0;

			// Dusk: half the night opacity
			if (nightImageryLayer) {
				nightImageryLayer.alpha = altitudeOpacity * 0.5;
				nightImageryLayer.brightness = 2.0;
				nightImageryLayer.contrast = 1.3;
				nightImageryLayer.gamma = 0.9;
			}
		}
		// Dawn: Transitioning from night
		else if (skyState === 'dawn') {
			dayImageryLayer.brightness = 0.45;
			dayImageryLayer.contrast = 1.0;
			dayImageryLayer.saturation = 0.7;
			dayImageryLayer.gamma = 1.2;
			dayImageryLayer.alpha = 1.0;

			// Dawn: quarter the night opacity (lights fading)
			if (nightImageryLayer) {
				nightImageryLayer.alpha = altitudeOpacity * 0.25;
				nightImageryLayer.brightness = 1.5;
				nightImageryLayer.contrast = 1.2;
				nightImageryLayer.gamma = 0.9;
			}
		}
		// Day: Full brightness, no night overlay
		else {
			if (dayImageryLayer) {
				dayImageryLayer.brightness = 1.0;
				dayImageryLayer.contrast = 1.0;
				dayImageryLayer.saturation = 1.0;
				dayImageryLayer.gamma = 1.0;
				dayImageryLayer.alpha = 1.0;
			}

			if (nightImageryLayer) {
				nightImageryLayer.alpha = 0.0;
			}

			// Restore atmosphere for daytime
			if (viewer.scene.skyAtmosphere) {
				viewer.scene.skyAtmosphere.brightnessShift = 0.0;
				viewer.scene.skyAtmosphere.saturationShift = 0.0;
			}
			viewer.scene.globe.showGroundAtmosphere = true;

			// Reset globe base color to default blue
			viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#000010');

		}
	}

	// Sync atmospheric visibility (fog density)
	function syncVisibility() {
		if (!viewer) return;

		// Base fog from visibility setting (5-100 km)
		const baseFogDensity = 0.00015 / (viewerState.visibility / 50);

		// Haze increases fog density significantly (0-1 range)
		// At max haze (1.0), fog is 100x denser
		const hazeMultiplier = 1 + viewerState.haze * 99;
		viewer.scene.fog.density = baseFogDensity * hazeMultiplier;

		// Haze slightly brightens shadows
		viewer.scene.fog.minimumBrightness = 0.03 + viewerState.haze * 0.08;
	}

	// Initialize Cesium viewer and handle cleanup
	// HMR-SAFE: Reuses existing viewer if available
	$effect(() => {
		// Skip if already initialized and viewer is valid
		if (HMR_CACHE.initialized && HMR_CACHE.viewer && !HMR_CACHE.viewer.isDestroyed()) {
			// Restore from cache
			viewer = HMR_CACHE.viewer;
			Cesium = HMR_CACHE.Cesium;
			osmBuildings = HMR_CACHE.osmBuildings;
			nightImageryLayer = HMR_CACHE.nightImageryLayer;
			dayImageryLayer = HMR_CACHE.dayImageryLayer;

			// Re-parent the canvas to the new container if needed
			if (container && viewer.container !== container) {
				// Move cesium widget to new container
				const cesiumWidget = viewer.cesiumWidget.container;
				if (cesiumWidget.parentElement !== container) {
					container.appendChild(cesiumWidget);
				}
			}

			if (import.meta.env.DEV) console.log('Cesium viewer restored from HMR cache');
			// Re-sync everything after HMR restore
			syncCamera();
			syncImageryLayer();
			syncBuildingStyle();
			lastSkyState = viewerState.skyState;
			viewer.scene.requestRender();
			return;
		}

		// Dynamically import Cesium to avoid SSR issues
		(async () => {
			try {
				Cesium = await import('cesium');
				HMR_CACHE.Cesium = Cesium;

				// Set Cesium Ion access token
				const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
				if (cesiumToken && cesiumToken !== 'your-cesium-ion-token-here') {
					Cesium.Ion.defaultAccessToken = cesiumToken;
				} else {
					console.warn('⚠️ Cesium Ion token not configured. Some features may not work. Get a free token at https://cesium.com/ion/tokens');
				}

				if (!container) return;

				// Create Cesium Viewer with minimal UI and no default imagery
				viewer = new Cesium.Viewer(container, {
					// Terrain with high resolution
					terrain: Cesium.Terrain.fromWorldTerrain({
						requestVertexNormals: true, // Better lighting on terrain
						requestWaterMask: true // Water surfaces
					}),

					// Start with no base imagery (we'll add layers manually)
					baseLayer: false,

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
					// Don't use requestRenderMode - it prevents continuous tile loading
					requestRenderMode: false,
					targetFrameRate: 60,
					// Use FXAA for smoother edges
					useBrowserRecommendedResolution: true
				});
				HMR_CACHE.viewer = viewer;

				// === QUALITY SETTINGS (optimized for RPi 4) ===
				// Screen space error: higher = less detail, lower = more detail
				// Default is 2, using 5 for RPi performance (less terrain detail)
				viewer.scene.globe.maximumScreenSpaceError = 5.0;
				// Disable preloading to reduce memory pressure
				viewer.scene.globe.preloadAncestors = false;
				viewer.scene.globe.preloadSiblings = false;
				// Smaller tile cache for RPi memory constraints (~32-64MB)
				viewer.scene.globe.tileCacheSize = 128;

				// Add day imagery layer (Cesium World Imagery - Bing Maps based)
				let dayImagerySource = 'none';
				try {
					dayImageryLayer = viewer.imageryLayers.addImageryProvider(
						await Cesium.IonImageryProvider.fromAssetId(2, {
							accessToken: Cesium.Ion.defaultAccessToken
						})
					);
					dayImageryLayer.alpha = 1.0;
					HMR_CACHE.dayImageryLayer = dayImageryLayer;
					dayImagerySource = 'Cesium Ion World Imagery (Bing)';
				} catch (error) {
					console.warn('Cesium Ion imagery failed, trying ESRI fallback...');
					// ESRI World Imagery - excellent quality, NO AUTH REQUIRED
					try {
						// Use fromUrl for Cesium 1.104+ API
						const esriProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
							'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
						);
						dayImageryLayer = viewer.imageryLayers.addImageryProvider(esriProvider);
						dayImageryLayer.alpha = 1.0;
						HMR_CACHE.dayImageryLayer = dayImageryLayer;
						dayImagerySource = 'ESRI World Imagery (no auth required)';
					} catch (esriError) {
						console.warn('ESRI failed, trying OSM fallback...');
						// Final fallback: OSM (lower resolution)
						try {
							dayImageryLayer = viewer.imageryLayers.addImageryProvider(
								new Cesium.OpenStreetMapImageryProvider({
									url: 'https://a.tile.openstreetmap.org/'
								})
							);
							dayImageryLayer.alpha = 1.0;
							HMR_CACHE.dayImageryLayer = dayImageryLayer;
							dayImagerySource = 'OpenStreetMap (fallback)';
						} catch (osmError) {
							console.error('All imagery providers failed');
						}
					}
				}
				if (import.meta.env.DEV) console.log(`Day imagery: ${dayImagerySource}`);

				// Add night lights layer (NASA sources - no API key required)
				// The night layer will be ON TOP of the day layer for proper overlay
				let nightSource = 'none';

				try {
					// NASA Earth at Night 2012 tiles (reliable, no API key)
					nightImageryLayer = viewer.imageryLayers.addImageryProvider(
						new Cesium.UrlTemplateImageryProvider({
							url: 'https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
							maximumLevel: 8,
							credit: new Cesium.Credit('NASA Earth at Night')
						})
					);
					nightSource = 'NASA Earth at Night 2012';
				} catch (error) {
					console.warn('NASA Earth at Night not available, trying GIBS...', error);

					// Fallback to NASA GIBS VIIRS Day/Night Band
					try {
						nightImageryLayer = viewer.imageryLayers.addImageryProvider(
							new Cesium.WebMapTileServiceImageryProvider({
								url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_SNPP_DayNightBand_ENCC/default/2023-01-01/500m/{TileMatrix}/{TileRow}/{TileCol}.png',
								layer: 'VIIRS_SNPP_DayNightBand_ENCC',
								style: 'default',
								format: 'image/png',
								tileMatrixSetID: '500m',
								maximumLevel: 8,
								credit: new Cesium.Credit('NASA GIBS')
							})
						);
						nightSource = 'NASA GIBS VIIRS';
					} catch (gibsError) {
						console.error('All night imagery sources failed:', gibsError);
					}
				}

				if (nightImageryLayer) {
					nightImageryLayer.alpha = 0.0; // Start hidden (day mode)
					// Ensure night layer is always on top of day layer
					viewer.imageryLayers.raiseToTop(nightImageryLayer);
					HMR_CACHE.nightImageryLayer = nightImageryLayer;
					if (import.meta.env.DEV) console.log(`Night lights: ${nightSource}`);
				}

				// Enable time-of-day lighting
				viewer.scene.globe.enableLighting = true;

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

				// HDR disabled for performance (can re-enable on powerful hardware)
				viewer.scene.highDynamicRange = false;

				// Shadows disabled for performance (major GPU cost)
				viewer.shadowMap.enabled = false;

				// Add OSM 3D Buildings
				try {
					osmBuildings = await Cesium.createOsmBuildingsAsync();
					viewer.scene.primitives.add(osmBuildings);
					HMR_CACHE.osmBuildings = osmBuildings;

					// Quality settings for buildings (balanced for performance)
					osmBuildings.maximumScreenSpaceError = 16;
					osmBuildings.skipLevelOfDetail = true;
					osmBuildings.preferLeaves = false;
					osmBuildings.maximumMemoryUsage = 256;

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

				// Mark as initialized
				HMR_CACHE.initialized = true;
				if (import.meta.env.DEV) console.log('Cesium viewer initialized');

				// Initial sync - camera, imagery, and building styles
				syncCamera();
				syncImageryLayer();
				syncBuildingStyle();
				lastSkyState = viewerState.skyState;
			} catch (error) {
				console.error('Failed to initialize Cesium:', error);
			}
		})();

		// Cleanup function - only destroy on full unmount, not HMR
		return () => {
			// Don't destroy on HMR - keep the viewer alive
			// Only clear local references
		};
	});

	// Track last settings for change detection
	let lastNightLightIntensity: number | null = null;
	let lastTerrainDarkness: number | null = null;
	let lastAltitudeForImagery: number | null = null;

	// Consolidated effect for all viewer state changes
	$effect(() => {
		if (!viewer || !Cesium) return;

		// Explicitly read position values to trigger reactivity when they change
		const {
			lat, lon, altitude, heading, pitch,
			skyState, nightLightIntensity, terrainDarkness
		} = viewerState;

		// Use position values to ensure Svelte tracks them
		void lat; void lon; void heading; void pitch;

		syncCamera();
		syncTime();
		syncBuildingVisibility();
		syncVisibility();

		const isNightTime = skyState === 'night' || skyState === 'dusk' || skyState === 'dawn';
		const nightSettingsChanged = isNightTime &&
			(lastNightLightIntensity !== nightLightIntensity || lastTerrainDarkness !== terrainDarkness);

		// Also update imagery when altitude changes significantly (affects night lights opacity)
		const altitudeChangedSignificantly = isNightTime &&
			lastAltitudeForImagery !== null &&
			Math.abs(altitude - lastAltitudeForImagery) > 500; // 500ft threshold

		if (lastSkyState !== skyState || nightSettingsChanged || altitudeChangedSignificantly) {
			syncImageryLayer();
			syncBuildingStyle();
			lastSkyState = skyState;
			lastNightLightIntensity = nightLightIntensity;
			lastTerrainDarkness = terrainDarkness;
			lastAltitudeForImagery = altitude;
		}

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
