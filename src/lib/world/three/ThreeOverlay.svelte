<script lang="ts">
	/**
	 * ThreeOverlay — transparent Three.js canvas mounted ABOVE Cesium.
	 *
	 * The Cesium+Three composition split:
	 *   Cesium  → terrain, imagery (EOX Sentinel-2 + VIIRS night lights),
	 *             atmosphere, color-grade shader, bloom — everything its
	 *             tile-streaming + post-process pipeline already does well.
	 *   Three   → clouds (the cluster sprite system) + future custom shader
	 *             effects that Cesium's fixed pipeline can't accommodate.
	 *
	 * Camera sync via <CameraMirror> — copies Cesium's positionWC /
	 * directionWC / upWC / fovy into our PerspectiveCamera every frame
	 * (Cesium-pull model, not push). The canvas itself is transparent
	 * (`alpha: true` + `background: transparent`) so Cesium shows through
	 * everywhere Three.js doesn't draw.
	 *
	 * Logarithmic depth + far 1e9 keep WGS84 scale precision. Near 1.0 (was
	 * 100) so camera-anchored cabin-space geometry (Wing, future cabin
	 * details) renders without near-plane clipping. logarithmicDepthBuffer
	 * is designed for huge dynamic ranges — precision at distant Cesium
	 * tiles is unaffected even with near = 1.
	 */
	import { Canvas, T } from '@threlte/core';
	import { Sky } from '@threlte/extras';
	import { PerspectiveCamera, WebGLRenderer, Color, Vector3 } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { registerLivenessCanvas } from '$lib/shell/liveness';
	import Clouds from './Clouds.svelte';
	import CameraMirror from './CameraMirror.svelte';
				import Venus from './Venus.svelte';
		import OsmRoads from './OsmRoads.svelte';
	import CityLightField from './CityLightField.svelte';
		import SparkleField from './SparkleField.svelte';
	import Meteors from './Meteors.svelte';
	import Rain from './Rain.svelte';
	import Wing from '$lib/shell/Wing.svelte';
	import { computeSunDirection, sunElevationSin } from '$lib/world/sky';
	import { lightingState } from '$lib/world/curves';

	type Vec3 = [number, number, number];

	const model = useAeroWindow();

	// $state.raw — Three.js camera mutated each frame, must not be proxied.
	let camera: PerspectiveCamera | undefined = $state.raw();

	// Environment ambient + IBL params now come from the unified lighting SSOT
	// (world/curves.ts) — the single owner of every day/dusk/night
	// response. Each value is its own $derived reading the raw model inputs so
	// Svelte invalidation is correct; lightingState is memoised so the repeated
	// calls collapse to ONE compute per frame.
	//
	// Pre-allocated scratch Color reused on every recompute. Threlte's
	// `<T.AmbientLight color={ambientTint}>` reads the .r/.g/.b directly via
	// Three.js's color reconciler — mutating-in-place still propagates.
	const _ambientTintScratch = new Color();
	const ambientTint = $derived.by(() => {
		// Pass the real local solar elevation so the ambient horizon boost
		// responds to actual sun height (it's the only lightingState field
		// that reads the third param).
		const elevSin = sunElevationSin(model.flight.camLat, model.timeOfDay);
		const s = lightingState(model.timeOfDay, model.nightFactor, elevSin);
		return _ambientTintScratch.setRGB(s.ambientColor[0], s.ambientColor[1], s.ambientColor[2]);
	});
	const ambientIntensity = $derived(lightingState(model.timeOfDay, model.nightFactor).ambientIntensity);
	// IBL <Sky> params: clearer/bluer by day, hazier-warm through dawn/dusk so
	// the environment cubemap matches the palette instead of fighting it.
	const skyTurbidity = $derived(lightingState(model.timeOfDay, model.nightFactor).skyTurbidity);
	const skyRayleigh = $derived(lightingState(model.timeOfDay, model.nightFactor).skyRayleigh);

	// Sun position for Threlte's <Sky> — driving the IBL cubemap.
	// THROTTLE: previously `sunPosVec` was a $derived that emitted a new
	// Vector3 every frame (since camLon + timeOfDay both update each
	// frame during flight). That meant Sky re-rendered its 64×64 cubemap
	// to scene.environment EVERY frame — ~0.5 ms of wasted GPU per Pi 5
	// tick when the sun typically moves <0.05° between frames.
	//
	// Now: a cached Vector3 in $state.raw that only updates when the sun
	// direction has moved more than ~0.5° (0.0087 rad). Below threshold
	// we return the cached vector — Sky's reactive prop comparison sees
	// the same object reference and skips re-rendering the cubemap.
	const SUN_MOVE_THRESHOLD_RAD = 0.0087;
	let sunPosVec = $state.raw(new Vector3(1, 0, 0).multiplyScalar(450000));
	// `_lastSunDir` is a PLAIN let (not $state.raw) — making it reactive
	// would cause the effect below to self-re-trigger on every threshold
	// crossing: reading it deps it, writing to it triggers a re-run.
	// We only need the cached value for comparison; no consumer outside
	// this effect needs reactive notification.
	// Store the LAST sun direction as 3 primitives, NOT a reference to
	// `d`. `computeSunDirection` returns a shared mutated array (memo
	// aliasing contract in sky.ts) — if we did `_lastSunDir = d`, the
	// next frame's call would rewrite that same array in place and our
	// dx/dy/dz comparison would always read 0, freezing the Sky
	// cubemap at boot. Three primitive scalars sidestep the alias.
	let _lastX = NaN, _lastY = NaN, _lastZ = NaN;
	$effect(() => {
		// Deep-night IBL freeze. The Sky cubemap drives scene.environment for
		// Three-side materials (Moon Lambert, etc.). At nightFactor > 0.85 the
		// sun is below horizon and the cubemap contributes near-zero — Moon
		// is lit by its own custom material instead. Skipping the re-render
		// entirely at deep night saves ~0.5 ms × the ~6 deep-night hours of
		// every kiosk day. Hysteresis: 0.85 enters freeze, 0.80 exits — no
		// boundary flicker if nightFactor jitters.
		if (model.nightFactor > 0.85) return;
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay) as Vec3;
		const dx = d[0] - _lastX;
		const dy = d[1] - _lastY;
		const dz = d[2] - _lastZ;
		if (Number.isFinite(_lastX)) {
			const angDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (angDist < SUN_MOVE_THRESHOLD_RAD) return;
		}
		_lastX = d[0]; _lastY = d[1]; _lastZ = d[2];
		// MUST be a new Vector3 instance — $state.raw only triggers
		// reactivity on assignment, not on in-place mutation. If we
		// did `sunPosVec.set(...)` here, Sky's prop comparison would
		// see the same object reference and never re-render the cubemap,
		// freezing the IBL at boot-time sun position.
		sunPosVec = new Vector3(d[0], d[1], d[2]).multiplyScalar(450000);
	});
</script>

<div class="three-overlay" aria-hidden="true">
	<Canvas
		createRenderer={(canvas) => {
			// Production hardening — register with the liveness watchdog +
			// log context loss. A lost GL context makes draws silent no-ops
			// (nothing throws), so only the watchdog's poll can notice.
			registerLivenessCanvas(canvas as HTMLCanvasElement);
			canvas.addEventListener('webglcontextlost', (e: Event) => {
				e.preventDefault();
				model.telemetry.recordEvent('error', { where: 'three-overlay', event: 'webglcontextlost' });
			});
			return new WebGLRenderer({
				canvas,
				antialias: true,
				alpha: true,
				powerPreference: 'high-performance',
				logarithmicDepthBuffer: true,
			});
		}}
	>
		<T.PerspectiveCamera
			bind:ref={camera}
			makeDefault
			fov={model.config.camera.parallax.fovDeg}
			near={1}
			far={1e9}
		/>

		<!-- Environment ambient from the unified lighting SSOT (lighting.ts):
		     continuous phase palette + air-mass horizon boost + nightFactor.
		     One owner of base lighting for all artistic overlays. -->
		<T.AmbientLight color={ambientTint} intensity={ambientIntensity} />

		<CameraMirror {camera} />
		<!-- Order matters for additive blending depth:
		     sun glow halo+core (sharp, renderOrder=0/1) →
		     lens flare (screen-space ghosts) →
		     stars (deep night, depthTest false) →
		     clouds (cluster sprites, world-anchored).
		     The sky is now Cesium's skyAtmosphere ONLY; the Threlte <Sky> below
		     stays as invisible IBL environment. (AtmosphericVeil — a second
		     Three-drawn warm-glow sky layer — was removed for that clean split.) -->
		<Venus />
		<Meteors />
		<!-- Far-layer bokeh carpet: thousands of soft warm dots over the whole
		     metro (VIIRS-placed, seeded). Strong at cruise, crossfades OUT toward
		     the ground as the sharp neon detail (OsmRoads) resolves. Sits between
		     the low-frequency glow dome (behind) and the sharp neon (on top). -->
		<CityLightField location={model.location} />
		<OsmRoads location={model.location} />
		<!-- (OsmBuildingEdges footprint-outline neon was removed here — the
		     CityLightField carpet + OsmRoads streets cover that read. Recover the
		     component from git history if a footprint layer is ever wanted again.) -->
		<Clouds
			density={model.effectiveCloudDensity}
			nightFactor={model.nightFactor}
			ambientColor={ambientTint}
			ambientIntensity={ambientIntensity}
			sunDirection={[...computeSunDirection(model.flight.camLon, model.timeOfDay)]}
		/>

		<!-- IBL-only Sky: invisible mesh (scale 0.0001), but renders to
		     a cubemap that becomes scene.environment. Three-side
		     materials (Moon mesh, future spheres) pick up an ambient
		     tint that matches actual sun position + atmospheric mood —
		     not stylized from a palette but physically derived. -->
		<Sky
			cubeMapSize={64}
			setEnvironment
			turbidity={skyTurbidity}
			rayleigh={skyRayleigh}
			mieCoefficient={0.005}
			mieDirectionalG={0.75}
			scale={0.0001}
			sunPosition={sunPosVec}
		/>

		<!-- Camera-tracked cabin-air dust motes. SparkleField wraps Threlte's
		     <Sparkles> in a group that follows the camera each frame so the
		     particles stay in view at WGS84 scale (Sparkles at scene origin
		     would fall millions of metres behind). -->
		<SparkleField />

		<!-- Camera-tracked rain particles — single Points draw call with
		     custom ShaderMaterial. Visibility gated by weather state with a
		     smooth 0.6 s ramp so transitions don't snap. Picks up bloom
		     from EffectStack. -->
		<Rain />

		<!-- Note: rain ON the glass (beads) is now CSS — shell/window/RainGlass.svelte
		     in the DOM glass layer (real backdrop-filter refraction, renderer-
		     agnostic). The old near-plane shader quad was retired. -->

		<!-- Wing — the extracted SW 737 right wing GLB (static/models/wing.glb),
		     camera-anchored with per-Pi fuselageOffsetM so a 3-Pi panorama sees
		     one continuous wing across three windows. The GLB's own panel/flap
		     detail carries the "you are on a plane" read — the old abstract
		     WingContrail Line2 was retired (it competed with the real wing). -->
		<Wing />

		<!-- Postprocessing chain: godrays + bloom + chromatic + tonemap + grain.
		     Replaces Threlte's autoRenderTask with EffectComposer.render(). -->
	</Canvas>
</div>

<style>
	.three-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		/* Above Cesium's canvas (which sits at z:0 inside .cesium-container)
		   but below the shell's HUD layers (z:10+). Matches scene/layers.ts
		   Z.CLOUDS where prod CSS3D clouds live. */
		z-index: 5;
	}
	.three-overlay :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
		background: transparent !important;
	}
</style>
