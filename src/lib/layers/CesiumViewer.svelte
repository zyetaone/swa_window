<script lang="ts">
	/**
	 * CesiumViewer - Terrain, imagery, night lighting, globe rendering, post-processing
	 *
	 * Cesium owns: terrain, satellite imagery, sky atmosphere, globe lighting,
	 *   NASA VIIRS City Lights (night lights), CartoDB Dark (real OSM road glow),
	 *   OSM 3D Buildings (enhanced night window shader), Google 3D Tiles (optional),
	 *   Post-processing: selective night bloom, environmental color grading.
	 * CSS layers handle: clouds, atmospheric glow, weather effects.
	 */
	import { useAppState, CESIUM } from "$lib/core";
	import { lerp } from "$lib/core/utils";
	import type * as CesiumType from "cesium";

	const model = useAppState();

	// ========================================================================
	// HMR CACHE — persists Cesium viewer across Vite hot reloads
	// ========================================================================

	interface CesiumHMRCache {
		viewer: CesiumType.Viewer | null;
		Cesium: typeof CesiumType | null;
		initialized: boolean;
		nightLayer: CesiumType.ImageryLayer | null;
		buildingsTileset: CesiumType.Cesium3DTileset | null;
		buildingsShader: CesiumType.CustomShader | null;
		google3DTileset: CesiumType.Cesium3DTileset | null;
		roadLightLayer: CesiumType.ImageryLayer | null;
		colorGradingStage: unknown | null;
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
			buildingsShader: null,
			google3DTileset: null,
			roadLightLayer: null,
			colorGradingStage: null,
		};
	}
	const HMR = globalAny.__CESIUM_HMR_CACHE__;

	// ========================================================================
	// LOCAL STATE
	// ========================================================================

	let viewer = $state<CesiumType.Viewer | null>(HMR.viewer);
	let Cesium: typeof CesiumType | null = HMR.Cesium;
	let nightLayer: CesiumType.ImageryLayer | null = HMR.nightLayer;
	let buildingsTileset: CesiumType.Cesium3DTileset | null =
		HMR.buildingsTileset;
	let buildingsShader = $state<CesiumType.CustomShader | null>(
		HMR.buildingsShader,
	);
	let google3DTileset: CesiumType.Cesium3DTileset | null =
		HMR.google3DTileset;
	let roadLightLayer: CesiumType.ImageryLayer | null = HMR.roadLightLayer;

	// ========================================================================
	// GLSL: Enhanced building shader
	// ========================================================================

	const BUILDING_SHADER_GLSL = `
		void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
			vec3 normal = normalize(fsInput.attributes.normalMC);

			// Surface orientation detection
			float upDot = abs(dot(normal, vec3(0.0, 0.0, 1.0)));
			float isWall = smoothstep(0.3, 0.7, 1.0 - upDot);
			float isRoof = smoothstep(0.7, 0.9, upDot);

			vec3 wp = fsInput.attributes.positionMC;
			float buildingHeight = wp.z;
			float floorHeight = 3.0;
			float floorIndex = floor(wp.z / floorHeight);
			float isGroundFloor = step(floorIndex, 0.5);

			// Height-based window density: taller buildings = more lit (office towers)
			float heightFactor = smoothstep(10.0, 80.0, buildingHeight);
			float adjustedDensity = mix(u_windowDensity * 0.4, u_windowDensity * 1.3, heightFactor);

			// Window grid pattern
			float windowWidth = mix(0.55, 0.8, isGroundFloor);
			float windowHeight = mix(0.65, 0.85, isGroundFloor);
			vec2 gridUV = fract(vec2(wp.x * 0.12, wp.z / floorHeight));
			float windowX = smoothstep(0.5 - windowWidth * 0.5, 0.5 - windowWidth * 0.5 + 0.05, gridUV.x)
			             * smoothstep(0.5 + windowWidth * 0.5, 0.5 + windowWidth * 0.5 - 0.05, gridUV.x);
			float windowY = smoothstep(0.5 - windowHeight * 0.5, 0.5 - windowHeight * 0.5 + 0.05, gridUV.y)
			             * smoothstep(0.5 + windowHeight * 0.5, 0.5 + windowHeight * 0.5 - 0.05, gridUV.y);
			float windowMask = windowX * windowY;

			// Per-window random (hash from cell position)
			vec2 cellId = vec2(floor(wp.x * 0.12), floorIndex);
			float rand = fract(sin(dot(cellId, vec2(127.1, 311.7))) * 43758.5453);

			// Floor-level randomization (some whole floors dark = empty offices)
			float floorRand = fract(sin(floorIndex * 131.7) * 43758.5453);
			float floorLit = step(0.2, floorRand);
			float fullyLitFloor = step(0.93, floorRand); // ~7% of floors fully lit

			float lit = step(1.0 - adjustedDensity, rand) * floorLit;
			lit = max(lit, fullyLitFloor); // fully lit floors override

			// Window color variation (5 types)
			float colorMix = fract(sin(dot(cellId, vec2(269.5, 183.3))) * 7461.7);
			vec3 warmColor = vec3(1.0, 0.65, 0.35);     // warm residential
			vec3 coolColor = vec3(0.8, 0.9, 1.0);        // cool office
			vec3 retailColor = vec3(1.0, 0.85, 0.6);     // retail/lobby
			vec3 screenColor = vec3(0.55, 0.65, 1.0);    // blueish screens
			vec3 officeWhite = vec3(1.0, 0.97, 0.92);    // fluorescent office

			vec3 upperColor = mix(
				mix(warmColor, coolColor, smoothstep(0.0, 0.4, colorMix)),
				mix(screenColor, officeWhite, smoothstep(0.6, 1.0, colorMix)),
				step(0.5, colorMix)
			);
			vec3 windowColor = mix(upperColor, retailColor, isGroundFloor);

			// Per-window brightness variation
			float brightVar = fract(sin(dot(cellId, vec2(419.2, 371.9))) * 29475.1);
			float windowBright = mix(0.6, 1.4, brightVar);

			// Subtle flicker (AC hum simulation)
			float flicker = 0.93 + 0.07 * sin(u_time * 0.3 + rand * 6.28);

			// Street-level ambient glow (sodium lamps illuminate building bases)
			float streetGlow = smoothstep(6.0, 0.0, wp.z) * 0.4;
			vec3 streetLampColor = vec3(1.0, 0.82, 0.45);

			// Rooftop aviation warning lights (tall buildings only, slow blink)
			float isTall = smoothstep(30.0, 50.0, buildingHeight);
			float blink = step(0.4, fract(u_time * 0.5));
			float rooftopLight = isRoof * isTall * blink;
			vec3 aviationRed = vec3(1.0, 0.08, 0.03);

			// Darken building surfaces at night
			material.diffuse *= mix(1.0, 0.015, u_nightFactor);

			// Compose emission layers
			vec3 emission = vec3(0.0);
			emission += windowColor * windowMask * lit * isWall * flicker * windowBright * 2.2;
			emission += streetLampColor * streetGlow * isWall;
			emission += aviationRed * rooftopLight * 4.0;

			material.emissive = emission * u_nightFactor;
		}
	`;

	// ========================================================================
	// GLSL: Environmental color grading post-process
	// ========================================================================

	const COLOR_GRADING_GLSL = `
		uniform sampler2D colorTexture;
		uniform float u_nightFactor;
		uniform float u_dawnDuskFactor;
		uniform float u_lightIntensity;
		in vec2 v_textureCoordinates;

		void main() {
			vec4 color = texture(colorTexture, v_textureCoordinates);
			vec3 rgb = color.rgb;
			float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

			// --- Night City Light Coloring ---
			// Threshold raised so dim terrain stays neutral — only actual lights get warm tint
			float lightMask = smoothstep(0.12, 0.5, lum);

			// Desaturate the base world color where lights are present
			// This prevents the underlying blue atmosphere/ground from turning orange lights into purple/mud
			vec3 grayBase = vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
			rgb = mix(rgb, grayBase, lightMask * 0.8 * u_nightFactor);

			// Sodium Vapor Palette (Warm/Industrial)
			vec3 sodium = vec3(1.0, 0.6, 0.2);     // Deep Orange
			vec3 amber  = vec3(1.0, 0.8, 0.4);     // Amber/Gold
			vec3 white  = vec3(1.0, 0.95, 0.9);    // Warm White

			// Simple distinct regions based on luminance intensity
			// (Brighter centers = white/amber, dimmer outskirts = sodium orange)
			vec3 lightColor = mix(sodium, amber, smoothstep(0.2, 0.6, lum));
			lightColor = mix(lightColor, white, smoothstep(0.6, 1.0, lum));

			// Additive blending for lights (emissive feel)
			// We add the light color on top of the darkened/desaturated terrain
			rgb += lightColor * lum * 2.5 * u_nightFactor;

			// Light pollution glow (subtle warm haze — only near bright sources)
			float pollution = smoothstep(0.25, 0.6, lum) * u_nightFactor;
			rgb += vec3(0.12, 0.06, 0.01) * pollution * u_lightIntensity;

			// Crush shadows
			float shadowCrush = 1.0 - (0.4 * u_nightFactor);
			rgb = pow(rgb, vec3(1.0 / shadowCrush));

			// High Contrast
			float contrast = 1.0 + (0.3 * u_nightFactor);
			rgb = (rgb - 0.5) * contrast + 0.5;

			out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
		}
	`;

	// ========================================================================
	// SYNC FUNCTIONS
	// ========================================================================

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

	function syncTerrainBrightness(
		layer: CesiumType.ImageryLayer,
		darkness: number,
	): void {
		const nf = model.nightFactor;
		// At night: darken terrain so city light layers dominate
		// Keep min at 0.08 — dark enough that shader only tints actual lights, not terrain
		layer.brightness = lerp(1.0, Math.max(0.08, 1.0 - darkness * 1.4), nf);
		layer.saturation = lerp(1.0, 0.0, nf); // full desaturation at night — kills blue
		layer.contrast = lerp(1.0, Math.max(0.6, 1.0 - darkness * 0.3), nf);
	}

	function syncNightLayers(): void {
		const nf = model.nightFactor;
		const intensityScale = model.nightLightScale;

		if (nightLayer) {
			// NASA VIIRS: high alpha so warm light data dominates over darkened terrain
			nightLayer.alpha = nf * 0.8;
			nightLayer.brightness = lerp(1.0, 3.5, nf) * intensityScale;
			nightLayer.contrast = 2.5;
			nightLayer.hue = 0.0;
			nightLayer.saturation = 0.0; // grayscale — shader applies warm tint
		}

		if (roadLightLayer) {
			// CartoDB Dark: Sharp road/building lines (The "mask")
			roadLightLayer.show = nf > 0.01;
			roadLightLayer.alpha = nf * 1.0; // Full visibility at night
			roadLightLayer.brightness = lerp(1.0, 4.0, nf) * intensityScale; // Very bright to cut through
			roadLightLayer.contrast = 1.5; // High contrast for "filament" look
			roadLightLayer.saturation = 0.0; // White/Grey roads
		}
	}

	function syncBuildings(): void {
		const nf = model.nightFactor;
		const intensityScale = model.nightLightScale;
		const google3DActive = !!google3DTileset;

		if (google3DTileset) {
			google3DTileset.show = true;
		}
		if (buildingsTileset) {
			buildingsTileset.show =
				model.showBuildings &&
				model.currentLocation.hasBuildings &&
				!google3DActive;

			if (buildingsShader) {
				buildingsShader.setUniform("u_nightFactor", nf);
				buildingsShader.setUniform(
					"u_windowDensity",
					nf > 0.01 ? 0.4 * intensityScale : 0.0,
				);
			}
		}
	}

	function syncGlobe(): void {
		if (!viewer || !Cesium) return;
		const nf = model.nightFactor;
		const dd = model.dawnDuskFactor;
		const loc = model.currentLocation;

		viewer.scene.globe.enableLighting = true;
		if (viewer.scene.light) viewer.scene.light.intensity = 1.0 - nf * 0.5;

		// Sky-aware base color (neutral dark at night — shader handles warm tint on lights only)
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

		// Location-aware terrain detail:
		// Nature locations — terrain IS the experience, demand sharper tiles
		// Cities — buildings provide visual interest, terrain can be coarser
		viewer.scene.globe.maximumScreenSpaceError = loc.hasBuildings
			? 1.2
			: 0.5;

		if (viewer.scene.skyAtmosphere) {
			viewer.scene.skyAtmosphere.brightnessShift = nf * -0.5;
			viewer.scene.skyAtmosphere.saturationShift = lerp(0, -0.8, nf) + dd * 0.2;
			viewer.scene.skyAtmosphere.hueShift = nf * 0.05; // warm shift at night
		}

		// Kill ground atmosphere blue scattering at night —
		// this is the #1 source of blue tint on city lights
		viewer.scene.globe.showGroundAtmosphere = nf < 0.3;

		// Bloom disabled — it processes raw scene colors before our warm shader,
		// amplifying any residual blue. The color grading shader handles glow instead.
		if (viewer.scene.postProcessStages?.bloom) {
			viewer.scene.postProcessStages.bloom.enabled = false;
		}

		// Location-aware atmosphere:
		// Each place has a distinct atmospheric character a passenger would feel
		//   Desert: crystal-clear dry air, minimal fog, vast visibility
		//   Ocean: marine haze, moisture in the air, softer horizon
		//   Mountains: thin crisp air, very clear, sharp edges
		//   Clouds: above the weather, minimal ground fog
		//   Cities: light haze, pollution softening the edges
		if (viewer.scene.fog) {
			viewer.scene.fog.enabled = true;
			viewer.scene.fog.screenSpaceErrorFactor = 2.0;

			const locId = model.location;
			let dayFogDensity: number;
			let nightFogDensity: number;
			let dayMinBright: number;
			let nightMinBright: number;

			if (locId === "desert") {
				// Sahara: dry, clear, vast — you can see forever
				dayFogDensity = 0.0003;
				nightFogDensity = 0.0001;
				dayMinBright = 0.6;
				nightMinBright = 0.005;
			} else if (locId === "ocean") {
				// Pacific: marine haze softens the horizon, moisture in air
				dayFogDensity = 0.0012;
				nightFogDensity = 0.0006;
				dayMinBright = 0.45;
				nightMinBright = 0.01;
			} else if (locId === "himalayas") {
				// Mountains: thin air, incredible clarity
				dayFogDensity = 0.0002;
				nightFogDensity = 0.0001;
				dayMinBright = 0.55;
				nightMinBright = 0.005;
			} else if (locId === "clouds") {
				// Above clouds: we ARE the weather layer
				dayFogDensity = 0.0005;
				nightFogDensity = 0.0002;
				dayMinBright = 0.7;
				nightMinBright = 0.01;
			} else if (loc.hasBuildings) {
				// Cities: urban haze, light pollution glow
				dayFogDensity = 0.0008;
				nightFogDensity = 0.0004;
				dayMinBright = 0.5;
				nightMinBright = 0.03;
			} else {
				// Default nature
				dayFogDensity = 0.0005;
				nightFogDensity = 0.0002;
				dayMinBright = 0.5;
				nightMinBright = 0.01;
			}

			viewer.scene.fog.density = lerp(dayFogDensity, nightFogDensity, nf);
			viewer.scene.fog.minimumBrightness = lerp(
				dayMinBright,
				nightMinBright,
				nf,
			);
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

	// ========================================================================
	// ATTACHMENT — Cesium init via {@attach}
	// ========================================================================

	function initCesium(node: HTMLDivElement) {
		// Restore from HMR cache if already initialized
		if (HMR.initialized && HMR.viewer && !HMR.viewer.isDestroyed()) {
			viewer = HMR.viewer;
			Cesium = HMR.Cesium;
			nightLayer = HMR.nightLayer;
			buildingsTileset = HMR.buildingsTileset;
			buildingsShader = HMR.buildingsShader;
			google3DTileset = HMR.google3DTileset;
			roadLightLayer = HMR.roadLightLayer;

			if (viewer.container !== node) {
				const w = viewer.cesiumWidget.container;
				if (w.parentElement !== node) node.appendChild(w);
			}
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

				viewer = new Cesium.Viewer(node, {
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

				// Visual quality
				viewer.scene.logarithmicDepthBuffer = true;
				viewer.scene.highDynamicRange = true;
				viewer.scene.postProcessStages.fxaa.enabled = true;
				if (abort.signal.aborted) return;
				HMR.viewer = viewer;

				// Globe setup
				const globe = viewer.scene.globe;
				globe.enableLighting = true;
				globe.baseColor = Cesium.Color.fromBytes(10, 8, 10, 255);
				globe.preloadAncestors = true; // Always on — gray void is the #1 immersion killer
				globe.preloadSiblings = true; // Smoother tile transitions at all locations
				globe.showGroundAtmosphere = true;

				if (viewer.scene.skyAtmosphere)
					viewer.scene.skyAtmosphere.show = true;
				if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;

				// Bloom post-processing defaults (tuned for selective city lights)
				if (viewer.scene.postProcessStages?.bloom) {
					const bloom = viewer.scene.postProcessStages.bloom;
					bloom.enabled = false;
					bloom.uniforms.brightness = CESIUM.BLOOM_BRIGHTNESS;
					bloom.uniforms.glowOnly = false;
					bloom.uniforms.contrast = CESIUM.BLOOM_NIGHT_CONTRAST;
					bloom.uniforms.delta = CESIUM.BLOOM_DELTA;
					bloom.uniforms.sigma = CESIUM.BLOOM_SIGMA;
					bloom.uniforms.stepSize = CESIUM.BLOOM_STEP_SIZE;
				}

				// Environmental color grading post-process stage
				try {
					const colorGrading = new Cesium.PostProcessStage({
						fragmentShader: COLOR_GRADING_GLSL,
						uniforms: {
							u_nightFactor: () => model.nightFactor,
							u_dawnDuskFactor: () => model.dawnDuskFactor,
							u_lightIntensity: () => model.nightLightScale,
						},
					});
					viewer.scene.postProcessStages.add(colorGrading);
					HMR.colorGradingStage = colorGrading;
				} catch {
					/* color grading is optional enhancement */
				}

				// Base imagery (ESRI with OSM fallback)
				try {
					const esri =
						await Cesium.ArcGisMapServerImageryProvider.fromUrl(
							"https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
						);
					if (abort.signal.aborted) return;
					viewer.imageryLayers.addImageryProvider(esri);
				} catch {
					if (abort.signal.aborted) return;
					viewer.imageryLayers.addImageryProvider(
						new Cesium.OpenStreetMapImageryProvider({
							url: "https://a.tile.openstreetmap.org/",
						}),
					);
				}

				// Cesium Ion features (terrain, 3D buildings)
				const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
				const hasIonToken =
					cesiumToken && cesiumToken !== "your-cesium-ion-token-here";

				if (hasIonToken) {
					(Cesium.Ion as typeof CesiumType.Ion).defaultAccessToken =
						cesiumToken;

					try {
						viewer.terrainProvider =
							await Cesium.createWorldTerrainAsync({
								requestVertexNormals: true,
							});
					} catch {
						/* flat fallback */
					}
				}
				if (abort.signal.aborted) return;

				// NASA VIIRS City Lights (GIBS WMTS — free, no token required)
				try {
					const nightProvider =
						new Cesium.WebMapTileServiceImageryProvider({
							url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg",
							layer: "VIIRS_CityLights_2012",
							style: "default",
							tileMatrixSetID: "GoogleMapsCompatible_Level8",
							maximumLevel: 8,
							format: "image/jpeg",
							credit: new Cesium.Credit("NASA Earth Observatory"),
						});

					nightLayer =
						viewer.imageryLayers.addImageryProvider(nightProvider);
					nightLayer.alpha = 0.0;
					nightLayer.brightness = 5.0; // "Radiance" intensity
					nightLayer.contrast = 2.5; // Clear data separation
					nightLayer.saturation = 0.0; // Raw data is grayscale, tinted by shader
				} catch {
					nightLayer = null;
				}
				if (abort.signal.aborted) return;

				// Google 3D Tiles OR OSM Buildings (mutually exclusive)
				const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
				const hasGoogleKey =
					googleApiKey &&
					googleApiKey !== "your_google_maps_api_key_here";

				if (hasGoogleKey) {
					try {
						google3DTileset =
							await Cesium.createGooglePhotorealistic3DTileset(
								googleApiKey,
							);
						if (abort.signal.aborted) return;
						google3DTileset.show = true;
						viewer.scene.primitives.add(google3DTileset);
					} catch {
						/* optional */
					}
				} else if (hasIonToken) {
					try {
						buildingsTileset =
							await Cesium.Cesium3DTileset.fromIonAssetId(96188);
						if (abort.signal.aborted) return;
						buildingsTileset.show = false;

						buildingsShader = new Cesium.CustomShader({
							uniforms: {
								u_nightFactor: {
									type: Cesium.UniformType.FLOAT,
									value: 0.0,
								},
								u_windowDensity: {
									type: Cesium.UniformType.FLOAT,
									value: 0.4,
								},
								u_time: {
									type: Cesium.UniformType.FLOAT,
									value: 0.0,
								},
							},
							fragmentShaderText: BUILDING_SHADER_GLSL,
						});
						buildingsTileset.customShader = buildingsShader;
						viewer.scene.primitives.add(buildingsTileset);
					} catch {
						/* buildings optional */
					}
				}
				if (abort.signal.aborted) return;

				// CartoDB Dark basemap for night road glow (street grid + traffic)
				const darkRoadProvider = new Cesium.UrlTemplateImageryProvider({
					url: "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
					credit: new Cesium.Credit(
						"OpenStreetMap contributors, CARTO",
					),
					maximumLevel: 18,
					minimumLevel: 0,
				});
				roadLightLayer =
					viewer.imageryLayers.addImageryProvider(darkRoadProvider);
				roadLightLayer.alpha = 0;
				roadLightLayer.colorToAlpha = new Cesium.Color(
					0.0,
					0.0,
					0.0,
					1.0,
				);
				roadLightLayer.colorToAlphaThreshold = 0.0; // Show all dark tiles as base

				// Ensure NASA night lights render ABOVE CartoDB roads
				if (nightLayer) viewer.imageryLayers.raiseToTop(nightLayer);

				// Persist to HMR cache
				HMR.nightLayer = nightLayer;
				HMR.buildingsTileset = buildingsTileset;
				HMR.buildingsShader = buildingsShader;
				HMR.google3DTileset = google3DTileset;
				HMR.roadLightLayer = roadLightLayer;
				HMR.initialized = true;

				syncCamera();
				syncClock();
				syncAtmosphere();
			} catch (e) {
				if (!abort.signal.aborted)
					console.error("Cesium init failed:", e);
			}
		})();

		return () => abort.abort();
	}

	// --- Camera sync (every frame — orbit changes lat/lon/heading continuously) ---
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

	// --- Atmosphere + lighting sync (fires on time/lighting/settings changes) ---
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

	// --- Building shader flicker (10fps timer) ---
	$effect(() => {
		if (!buildingsShader) return;
		const shader = buildingsShader;
		const interval = setInterval(() => {
			shader.setUniform("u_time", performance.now() / 1000);
		}, 100);
		return () => clearInterval(interval);
	});
</script>

<div {@attach initCesium} class="cesium-viewer"></div>

<style>
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
</style>
