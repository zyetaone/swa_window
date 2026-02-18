<script lang="ts">
	/**
	 * CesiumViewer - Terrain, imagery, night lighting, globe rendering, post-processing
	 *
	 * Cesium owns: terrain, satellite imagery, sky atmosphere, globe lighting,
	 *   NASA VIIRS City Lights (night lights), CartoDB Dark (real OSM road glow),
	 *   Google 3D Tiles (optional), color grading post-process.
	 * CSS layers handle: clouds, atmospheric glow, weather effects.
	 */
	import { useAppState, CESIUM } from "$lib/core";
	import { lerp } from "$lib/core/utils";
	import type { WindowModel } from "$lib/core/WindowModel.svelte";
	import type * as CesiumType from "cesium";
	import {
		COLOR_GRADING_GLSL,
	} from "./cesium-shaders";

	const model = useAppState();

	// HMR CACHE — persists Cesium viewer across Vite hot reloads
	// Post-process stages (bloom, color grading) live on the viewer and don't need caching.
	interface CesiumHMRCache {
		viewer: CesiumType.Viewer | null;
		Cesium: typeof CesiumType | null;
		initialized: boolean;
		nightLayer: CesiumType.ImageryLayer | null;
		buildingsTileset: CesiumType.Cesium3DTileset | null;

		google3DTileset: CesiumType.Cesium3DTileset | null;
		roadLightLayer: CesiumType.ImageryLayer | null;
	}

	const globalAny = globalThis as unknown as {
		__CESIUM_HMR_CACHE__?: CesiumHMRCache;
	};
	if (!globalAny.__CESIUM_HMR_CACHE__) {
		globalAny.__CESIUM_HMR_CACHE__ = {
			viewer: null,
			Cesium: null,
			initialized: false,
			nightLayer: null,
			buildingsTileset: null,

			google3DTileset: null,
			roadLightLayer: null,
		};
	}
	const HMR = globalAny.__CESIUM_HMR_CACHE__!;

	// LOCAL STATE

	let loading = $state(!HMR.initialized);
	let fadingOut = $state(false); // Two-state loading overlay fade
	let error = $state<string | null>(null);
	let viewerContainer: HTMLDivElement; // bind:this for retry

	let viewer = $state<CesiumType.Viewer | null>(HMR.viewer);
	let Cesium: typeof CesiumType | null = HMR.Cesium;
	let nightLayer: CesiumType.ImageryLayer | null = HMR.nightLayer;
	let buildingsTileset: CesiumType.Cesium3DTileset | null =
		HMR.buildingsTileset;
	let google3DTileset: CesiumType.Cesium3DTileset | null =
		HMR.google3DTileset;
	let roadLightLayer: CesiumType.ImageryLayer | null = HMR.roadLightLayer;

	// SYNC FUNCTIONS
	function syncCamera(): void {
		if (!viewer || !Cesium) return;
		viewer.camera.setView({
			destination: Cesium.Cartesian3.fromDegrees(
				model.lon,
				model.lat,
				model.altitude * 0.3048,
			),
			orientation: {
				heading: Cesium.Math.toRadians((model.heading + 90) % 360),
				pitch: Cesium.Math.toRadians(model.pitch - 90),
				roll: Cesium.Math.toRadians(-model.bankAngle),
			},
		});
	}

	function syncClock(): void {
		if (!viewer || !Cesium) return;
		const now = new Date();
		// Normalize to [0,24) to handle negative UTC offsets safely
		const utcHour = (((model.timeOfDay - model.utcOffset) % 24) + 24) % 24;
		const hours = Math.floor(utcHour);
		const minutes = Math.floor((utcHour % 1) * 60);
		viewer.clock.currentTime = Cesium.JulianDate.fromDate(
			new Date(
				Date.UTC(
					now.getUTCFullYear(),
					now.getUTCMonth(),
					now.getUTCDate(),
					hours,
					minutes,
				),
			),
		);
	}

	function syncTerrainBrightness(layer: CesiumType.ImageryLayer, darkness: number): void {
		const nf = model.nightFactor;
		layer.brightness = lerp(1.0, Math.max(0.08, 1.0 - darkness * 1.4), nf);
		layer.saturation = lerp(1.0, 0.0, nf);
		layer.contrast = lerp(1.0, Math.max(0.6, 1.0 - darkness * 0.3), nf);
	}

	function syncNightLayers(): void {
		const nf = model.nightFactor;
		const intensityScale = model.nightLightScale;

		if (nightLayer) {
			// NASA VIIRS: city light overlay — subtle glow, not a full layer replacement
			nightLayer.alpha = nf * CESIUM.VIIRS_NIGHT_ALPHA;
			nightLayer.brightness = lerp(1.0, CESIUM.VIIRS_NIGHT_BRIGHTNESS, nf) * intensityScale;
			nightLayer.contrast = CESIUM.VIIRS_CONTRAST;
			nightLayer.hue = 0.0;
			nightLayer.saturation = 0.0;
		}

		if (roadLightLayer) {
			// CartoDB Dark: road/building outlines — colorToAlpha makes dark areas transparent
			roadLightLayer.show = nf > 0.01;
			roadLightLayer.alpha = nf * CESIUM.ROAD_LIGHT_NIGHT_ALPHA;
			roadLightLayer.brightness = lerp(1.0, CESIUM.ROAD_LIGHT_NIGHT_BRIGHTNESS, nf) * intensityScale;
			roadLightLayer.contrast = CESIUM.ROAD_LIGHT_CONTRAST;
			roadLightLayer.saturation = CESIUM.ROAD_LIGHT_SATURATION;
		}
	}

	function syncBuildings(): void {
		if (buildingsTileset) {
			buildingsTileset.show = model.showBuildings;
		}
		if (google3DTileset) {
			google3DTileset.show = true;
		}
	}

	function syncGlobe(): void {
		if (!viewer || !Cesium) return;
		const nf = model.nightFactor;
		const dd = model.dawnDuskFactor;
		const loc = model.currentLocation;

		viewer.scene.globe.enableLighting = true;
		if (viewer.scene.light) viewer.scene.light.intensity = 1.0 - nf * 0.5;

		let r = lerp(140, 8, nf),
			g = lerp(170, 8, nf),
			b = lerp(200, 8, nf);
		r = lerp(r, 100, dd * 0.3);
		g = lerp(g, 80, dd * 0.3);
		b = lerp(b, 70, dd * 0.3);
		viewer.scene.globe.baseColor = Cesium.Color.fromBytes(
			Math.round(r),
			Math.round(g),
			Math.round(b),
			255,
		);

		// LOD: Lower = sharper but harder on memory/network. At cruise altitude
		// (28-35k ft) far tiles are visible, so a softer threshold prevents the
		// hard LOD seam where high-res stops and low-res begins.
		const altFt = model.altitude;
		const isCruise = altFt > 20000;
		viewer.scene.globe.maximumScreenSpaceError = isCruise
			? 2.5  // Softer at cruise — hides LOD seam on far terrain
			: loc.hasBuildings ? 1.5 : 2.0;

		if (viewer.scene.skyAtmosphere) {
			viewer.scene.skyAtmosphere.brightnessShift = nf * -0.5;
			viewer.scene.skyAtmosphere.saturationShift = lerp(0, -0.8, nf) + dd * 0.2;
			viewer.scene.skyAtmosphere.hueShift = nf * 0.05; // warm shift at night
		}

		viewer.scene.globe.showGroundAtmosphere = nf < 0.3;

		// Built-in bloom: enable only at full night for warm city glow
		if (viewer.scene.postProcessStages?.bloom) {
			viewer.scene.postProcessStages.bloom.enabled = nf > 0.7;
		}

		// Location-aware fog: [dayDensity, nightDensity, dayMinBright, nightMinBright]
		if (viewer.scene.fog) {
			viewer.scene.fog.enabled = true;
			viewer.scene.fog.screenSpaceErrorFactor = 4.0;
			const locId = model.location;
			const fogParams: Record<string, [number, number, number, number]> = {
				desert:    [0.0003, 0.0001, 0.6,  0.005],
				ocean:     [0.0012, 0.0006, 0.45, 0.01],
				himalayas: [0.0002, 0.0001, 0.55, 0.005],
				clouds:    [0.0005, 0.0002, 0.7,  0.01],
			};
			const cityDefault: [number, number, number, number] = [0.0008, 0.0004, 0.5, 0.03];
			const natureDefault: [number, number, number, number] = [0.0005, 0.0002, 0.5, 0.01];
			const [dayDens, nightDens, dayBright, nightBright] =
				fogParams[locId] ?? (loc.hasBuildings ? cityDefault : natureDefault);
			viewer.scene.fog.density = lerp(dayDens, nightDens, nf);
			viewer.scene.fog.minimumBrightness = lerp(dayBright, nightBright, nf);
		}
	}

	function syncAtmosphere(): void {
		if (!viewer || !Cesium) return;
		const baseLayer = viewer.imageryLayers.get(0);
		if (baseLayer) syncTerrainBrightness(baseLayer, model.terrainDarkness);
		syncNightLayers();
		syncBuildings();
		syncGlobe();
	}

	// INIT HELPERS (decomposed from monolithic initCesium)
	async function createCesiumViewer(
		node: HTMLDivElement,
		C: typeof CesiumType,
		signal: AbortSignal,
	): Promise<CesiumType.Viewer> {
		const v = new C.Viewer(node, {
			baseLayer: false,
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
			shadows: false,
			useBrowserRecommendedResolution: false,
			contextOptions: {
				webgl: {
					alpha: false,
					antialias: true,
					preserveDrawingBuffer: true,
				},
			},
		});

		v.scene.logarithmicDepthBuffer = true;
		v.scene.highDynamicRange = true;
		v.scene.postProcessStages.fxaa.enabled = true;
		if (signal.aborted) throw new DOMException("Aborted", "AbortError");

		const globe = v.scene.globe;
		globe.enableLighting = true;
		globe.baseColor = C.Color.fromBytes(40, 50, 60, 255);
		globe.preloadAncestors = true;
		globe.preloadSiblings = true;
		globe.tileCacheSize = 300;
		globe.loadingDescendantLimit = 8;
		globe.showGroundAtmosphere = true;

		if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
		if (v.scene.skyBox) v.scene.skyBox.show = true;

		if (v.scene.postProcessStages?.bloom) {
			const bloom = v.scene.postProcessStages.bloom;
			bloom.enabled = false;
			bloom.uniforms.brightness = CESIUM.BLOOM_BRIGHTNESS;
			bloom.uniforms.glowOnly = false;
			bloom.uniforms.contrast = CESIUM.BLOOM_NIGHT_CONTRAST;
			bloom.uniforms.delta = CESIUM.BLOOM_DELTA;
			bloom.uniforms.sigma = CESIUM.BLOOM_SIGMA;
			bloom.uniforms.stepSize = CESIUM.BLOOM_STEP_SIZE;
		}

		return v;
	}

	function setupPostProcessing(
		v: CesiumType.Viewer,
		C: typeof CesiumType,
		m: WindowModel,
	): void {
		try {
			const colorGrading = new C.PostProcessStage({
				fragmentShader: COLOR_GRADING_GLSL,
				uniforms: {
					u_nightFactor: () => m.nightFactor,
					u_dawnDuskFactor: () => m.dawnDuskFactor,
					u_lightIntensity: () => m.nightLightScale,
				},
			});
			v.scene.postProcessStages.add(colorGrading);
		} catch (e) {
			console.warn("[CesiumViewer] Color grading shader failed:", e);
		}

		// NOTE: Selective night bloom pipeline removed — it was architecturally broken.
		// With inputPreviousStageTexture: true, the composite stage's colorTexture
		// received the blurred bloom output (not the original scene), causing a black
		// screen at nightFactor=0 since extract × 0 = black propagated through.
		// TODO: Re-implement bloom using Cesium's built-in bloom or a correct
		// two-branch pipeline that preserves access to the original scene texture.
	}

	async function setupImageryLayers(
		v: CesiumType.Viewer,
		C: typeof CesiumType,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const esri = await C.ArcGisMapServerImageryProvider.fromUrl(
				"https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
			);
			if (signal.aborted) return;
			v.imageryLayers.addImageryProvider(esri);
		} catch (e) {
			console.warn("[CesiumViewer] ESRI imagery failed, falling back to OSM:", e);
			if (signal.aborted) return;
			v.imageryLayers.addImageryProvider(
				new C.OpenStreetMapImageryProvider({
					url: "https://a.tile.openstreetmap.org/",
				}),
			);
		}

		const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
		const hasIonToken =
			cesiumToken && cesiumToken !== "your-cesium-ion-token-here";

		if (hasIonToken) {
			(C.Ion as typeof CesiumType.Ion).defaultAccessToken = cesiumToken;

			try {
				v.terrainProvider = await C.createWorldTerrainAsync({
					requestVertexNormals: true,
				});
			} catch (e) {
				console.warn("[CesiumViewer] Ion terrain failed, using flat ellipsoid:", e);
			}
		}
		if (signal.aborted) return;

		try {
			const nightProvider = new C.WebMapTileServiceImageryProvider({
				url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg",
				layer: "VIIRS_CityLights_2012",
				style: "default",
				tileMatrixSetID: "GoogleMapsCompatible_Level8",
				maximumLevel: 8,
				format: "image/jpeg",
				credit: new C.Credit("NASA Earth Observatory"),
			});

			nightLayer = v.imageryLayers.addImageryProvider(nightProvider);
			nightLayer.alpha = 0.0;
			nightLayer.brightness = 1.0;
			nightLayer.contrast = CESIUM.VIIRS_CONTRAST;
			nightLayer.saturation = 0.0;
			nightLayer.colorToAlpha = new C.Color(0.0, 0.0, 0.0, 1.0);
			nightLayer.colorToAlphaThreshold = CESIUM.VIIRS_COLOR_TO_ALPHA_THRESHOLD;
		} catch (e) {
			console.warn("[CesiumViewer] NASA VIIRS night lights failed:", e);
			nightLayer = null;
		}
		if (signal.aborted) return;

		try {
			const darkRoadProvider = new C.UrlTemplateImageryProvider({
				url: "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
				credit: new C.Credit("OpenStreetMap contributors, CARTO"),
				maximumLevel: 18,
				minimumLevel: 0,
			});
			roadLightLayer = v.imageryLayers.addImageryProvider(darkRoadProvider);
			roadLightLayer.alpha = 0;
			roadLightLayer.colorToAlpha = new C.Color(0.0, 0.0, 0.0, 1.0);
			roadLightLayer.colorToAlphaThreshold = CESIUM.ROAD_LIGHT_COLOR_TO_ALPHA_THRESHOLD;
		} catch (e) {
			console.warn("[CesiumViewer] CartoDB road glow failed:", e);
			roadLightLayer = null;
		}

		if (nightLayer) v.imageryLayers.raiseToTop(nightLayer);
	}

	async function setupBuildings3D(
		v: CesiumType.Viewer,
		C: typeof CesiumType,
		signal: AbortSignal,
	): Promise<void> {
		// NOTE: Ion OSM Buildings (asset 96188) still triggers "Primitive outlines
		// disable imagery draping" on Cesium 1.138. The CESIUM_primitive_outline
		// extension in the tileset degrades terrain imagery quality. At cruise altitude
		// (28-35k ft) the extruded boxes are invisible anyway — not worth the tradeoff.
		// Keeping disabled until Cesium fixes the extension or we find an alternative source.

		// Google 3D Tiles (optional, photorealistic)
		const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
		const hasGoogleKey =
			googleApiKey && googleApiKey !== "your_google_maps_api_key_here";

		if (hasGoogleKey) {
			try {
				google3DTileset =
					await C.createGooglePhotorealistic3DTileset(googleApiKey);
				if (signal.aborted) return;
				google3DTileset.show = true;
				v.scene.primitives.add(google3DTileset);
			} catch (e) {
				console.warn("[CesiumViewer] Google 3D Tiles failed:", e);
			}
		}
	}

	// ATTACHMENT — Cesium init via {@attach}
	/** Trigger loading fade-out. Call instead of `loading = false`. */
	function finishLoading(): void {
		fadingOut = true;
	}

	function retryInit(node: HTMLDivElement) {
		error = null;
		loading = true;
		fadingOut = false;
		HMR.initialized = false;
		HMR.viewer = null;
		initCesium(node);
	}

	function initCesium(node: HTMLDivElement) {
		// Restore from HMR cache if already initialized
		if (HMR.initialized && HMR.viewer && !HMR.viewer.isDestroyed()) {
			viewer = HMR.viewer;
			Cesium = HMR.Cesium;
			nightLayer = HMR.nightLayer;
			buildingsTileset = HMR.buildingsTileset;

			google3DTileset = HMR.google3DTileset;
			roadLightLayer = HMR.roadLightLayer;

			if (viewer.container !== node) {
				const w = viewer.cesiumWidget.container;
				if (w.parentElement !== node) node.appendChild(w);
			}
			finishLoading();
			syncCamera();
			syncClock();
			syncAtmosphere();
			return;
		}

		// Fresh init — AbortController cancels in-flight async work if HMR fires mid-init
		const abort = new AbortController();

		(async () => {
			try {
				(globalThis as Record<string, unknown>).CESIUM_BASE_URL =
					"/cesiumStatic";
				Cesium = await import("cesium");
				if (abort.signal.aborted || !Cesium?.Viewer) return;
				HMR.Cesium = Cesium;

				viewer = await createCesiumViewer(node, Cesium, abort.signal);
				HMR.viewer = viewer;

				setupPostProcessing(viewer, Cesium, model);

				await setupImageryLayers(viewer, Cesium, abort.signal);
				if (abort.signal.aborted) return;

				await setupBuildings3D(viewer, Cesium, abort.signal);
				if (abort.signal.aborted) return;

				// Persist to HMR cache
				HMR.nightLayer = nightLayer;
				HMR.buildingsTileset = buildingsTileset;

				HMR.google3DTileset = google3DTileset;
				HMR.roadLightLayer = roadLightLayer;
				HMR.initialized = true;

				finishLoading();
				syncCamera();
				syncClock();
				syncAtmosphere();
			} catch (e) {
				if (!abort.signal.aborted) {
					const msg = e instanceof Error ? e.message : "Unknown error";
					error = `Terrain initialization failed: ${msg}`;
					loading = false;
					fadingOut = false;
				}
			}
		})();

		return () => abort.abort();
	}

	// Camera sync (every frame)
	$effect(() => {
		if (!viewer) return;
		void model.lat;
		void model.lon;
		void model.altitude;
		void model.heading;
		void model.pitch;
		void model.bankAngle;
		syncCamera();
	});

	// Atmosphere + lighting sync
	$effect(() => {
		if (!viewer) return;
		void model.nightFactor;
		void model.dawnDuskFactor;
		void model.terrainDarkness;
		void model.altitude;
		void model.showBuildings;
		void model.location;
		void model.timeOfDay;
		void model.nightLightIntensity;
		syncClock();
		syncAtmosphere();
	});

</script>

<div class="cesium-container">
	<div {@attach initCesium} bind:this={viewerContainer} class="cesium-viewer"></div>

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
					onclick={() => {
						if (viewerContainer) retryInit(viewerContainer);
					}}
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
		background: rgb(5 5 10 / 0.95);
		opacity: 1;
		transition: opacity 0.6s ease-out;
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
		word-break: break-word;
	}

	.error-retry {
		margin-top: 0.5rem;
		padding: 0.4rem 1.5rem;
		background: rgb(255 255 255 / 0.08);
		color: rgb(255 255 255 / 0.7);
		border: 1px solid rgb(255 255 255 / 0.15);
		border-radius: 6px;
		font-size: 0.8rem;
		font-family: system-ui, -apple-system, sans-serif;
		cursor: pointer;
		transition: background 0.2s, color 0.2s, border-color 0.2s;
	}

	.error-retry:hover {
		background: rgb(255 255 255 / 0.15);
		color: rgb(255 255 255 / 0.9);
		border-color: rgb(255 255 255 / 0.25);
	}
</style>
