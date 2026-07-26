<script lang="ts">
	/**
	 * Moon — sphere mesh with custom ShaderMaterial + additive halo sprite.
	 *
	 * Previously: two flat sprites stacked (core + halo). Read as a sticker.
	 * Now: a real Three.js sphere shaded with:
	 *   - Lambert lighting from the sun direction (soft terminator)
	 *   - Procedural value-noise cratering (low-frequency mottling — gives
	 *     the disc visible surface detail without a texture asset)
	 *   - Mild limb darkening (subtle silhouette fade)
	 *   - Bloom-friendly: the bright lit lambert side punches through
	 *     EffectStack's bloom threshold producing a real glow halo
	 *
	 * Geometry simplification: moon_pos = −sunDir × placement. The PLACEMENT
	 * stays anti-sun — a deliberate theatrical shortcut so the moon rises at
	 * dusk, matching the "moon comes out at night" feel passengers expect
	 * (real placement would need a lunar ephemeris). The ILLUMINATION,
	 * however, is phase-true: the Lambert sun-direction uniform is rotated
	 * by the real date-derived phase angle (moonPhaseFraction in sky.ts —
	 * same illuminated-fraction quantity compose.ts feeds Cesium moonlight),
	 * so the terminator renders an honest gibbous/crescent instead of a
	 * perpetual full moon.
	 *
	 * The halo sprite is retained as a separate additive billboard — it
	 * carries the soft atmospheric scatter and benefits from bloom.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import {
		AdditiveBlending,
		Color,
		ShaderMaterial,
		Vector3,
		type Mesh,
		type Sprite as ThreeSprite,
	} from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection, sunElevationSin, moonPhaseFraction, SUN_PLACEMENT_M } from './sky';
	import { lightingState } from '$lib/world-lighting/curves';
	import { earthOcclusionFactor } from './occlusion';
	import { makeRadialTexture } from './texture-util';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Moon mirrors the sun's placement radius (same as SUN_PLACEMENT_M
	// from sky.ts) on the anti-sun side. Aliased here for clarity but
	// reads from the single source of truth.
	const MOON_PLACEMENT_M = SUN_PLACEMENT_M;
	const MOON_RADIUS_M = 2.0e6;
	// Halo widened 8×→10× the disc so the moon carries a soft atmospheric
	// scatter glow that makes it findable in a wide night frame — the eye
	// catches the bloom before the disc. Still well within camera.far.
	const MOON_HALO_SIZE_M = MOON_RADIUS_M * 10;

	// Single sun-direction computation shared by moonOffset, airMassFactor,
	// and the uniform $effect. Previously each derived its own call — 3×
	// the trig ops per reactive cycle for the same anti-sun vector.
	const sunDir = $derived(computeSunDirection(model.flight.camLon, model.timeOfDay));

	// Parallax fix: moon position used to be world-anchored at
	// (-sunDir × 6e7). Camera at WGS84 positions ~6.4e6 m from origin
	// produced ~10° parallax shift as the camera flew between cities
	// — moon visibly drifted across the sky for the wrong reason.
	// Re-derived as cameraPosition + (-sunDir × placement), so the moon
	// is now always at a FIXED relative direction from the camera —
	// effectively at infinite distance, which is the physically correct
	// behavior for a celestial body. Sun direction still updates with
	// timeOfDay so the moon still moves across the sky over the night.
	const moonOffset = $derived.by<[number, number, number]>(() => {
		const d = sunDir;
		return [-d[0] * MOON_PLACEMENT_M, -d[1] * MOON_PLACEMENT_M, -d[2] * MOON_PLACEMENT_M];
	});

	// moonOffset is read in the useTask below where it's combined with
	// the camera's live world position. Reading ctx.camera.current.position
	// in a $derived doesn't track Three.js's in-place mutation, hence the
	// per-frame application path in useTask.

	// Moon air mass from the REAL local elevation. The moon sits anti-sun, so
	// its elevation is the negated solar elevation (sunElevationSin in sky.ts).
	// Previously this read -sunDir[1] — a CONSTANT polar-axis projection — so
	// the horizon boost was frozen at one mid-state value all night.
	const airMassFactor = $derived.by(() => {
		const moonElev = Math.max(
			-0.12,
			Math.min(1, -sunElevationSin(model.flight.camLat, model.timeOfDay)),
		);
		return 1.0 / Math.max(0.12, moonElev + 0.12);
	});

	// Ray-sphere occlusion against Earth (earthOcclusionFactor from
	// ./occlusion). Updated each frame in useTask since it depends on
	// camera world position, not just sun direction. 0 = moon hidden by
	// Earth, 1 = moon visible, soft fade across the limb.
	let occlusionFactor = $state(1);

	const moonVisibility = $derived.by(() => {
		// Moon ramp from the unified lighting SSOT. lightingState returns a
		// SHARED mutated object — read the scalar in the same expression,
		// never store the reference.
		const nfGate = lightingState(model.timeOfDay, model.nightFactor).moonContribution;
		const horizonBoost = 1 + Math.min(0.9, (airMassFactor - 1) * 0.22);
		// Multiply by Earth-occlusion factor (computed per frame in useTask
		// below). The previous `Math.max(0, -sunDir[1])` gate was wrong: in
		// sky.ts, sunDir[1] = sin(SUN_TILT) ≈ +0.397 is a CONSTANT axial-
		// tilt projection, not a camera-local altitude — so the gate would
		// have always zeroed the moon. Proper ray-sphere math against the
		// real camera position handles oblique angles + multi-Pi parallax.
		return nfGate * horizonBoost * occlusionFactor;
	});

	// Log-depth chunks: the renderer uses logarithmicDepthBuffer, so the wing's
	// (built-in material) depth writes are log-encoded. This custom shader now
	// depth-TESTS against them (so the wing occludes the moon) — which only
	// compares correctly if it computes the same log depth, hence the
	// <logdepthbuf_*> includes. <common> provides isPerspectiveMatrix() the
	// vertex chunk needs.
	const VS = /* glsl */ `
		#include <common>
		#include <logdepthbuf_pars_vertex>
		varying vec3 vWorldNormal;
		varying vec3 vViewDir;
		void main() {
			vec4 worldPos = modelMatrix * vec4(position, 1.0);
			vWorldNormal = normalize(mat3(modelMatrix) * normal);
			vViewDir = normalize(cameraPosition - worldPos.xyz);
			gl_Position = projectionMatrix * viewMatrix * worldPos;
			#include <logdepthbuf_vertex>
		}
	`;

	const FS = /* glsl */ `
		#include <logdepthbuf_pars_fragment>
		uniform vec3 uSunDir;
		uniform vec3 uMoonTint;
		uniform float uVisibility;
		varying vec3 vWorldNormal;
		varying vec3 vViewDir;

		// Cheap value noise from a hashed coord.
		float hash(vec3 p) {
			return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
		}
		float vnoise(vec3 p) {
			vec3 i = floor(p);
			vec3 f = fract(p);
			float n000 = hash(i);
			float n100 = hash(i + vec3(1.0, 0.0, 0.0));
			float n010 = hash(i + vec3(0.0, 1.0, 0.0));
			float n110 = hash(i + vec3(1.0, 1.0, 0.0));
			float n001 = hash(i + vec3(0.0, 0.0, 1.0));
			float n101 = hash(i + vec3(1.0, 0.0, 1.0));
			float n011 = hash(i + vec3(0.0, 1.0, 1.0));
			float n111 = hash(i + vec3(1.0, 1.0, 1.0));
			vec3 u = f * f * (3.0 - 2.0 * f);
			float nx00 = mix(n000, n100, u.x);
			float nx10 = mix(n010, n110, u.x);
			float nx01 = mix(n001, n101, u.x);
			float nx11 = mix(n011, n111, u.x);
			float nxy0 = mix(nx00, nx10, u.y);
			float nxy1 = mix(nx01, nx11, u.y);
			return mix(nxy0, nxy1, u.z);
		}

		void main() {
			#include <logdepthbuf_fragment>
			// Lambert with a soft terminator — eliminates the harsh
			// day/night edge a raw step would produce.
			float lambert = dot(vWorldNormal, uSunDir);
			float lit = smoothstep(-0.06, 0.28, lambert);

			// Procedural cratering — 2-octave value noise on the world normal.
			// 0.78–1.04 range so the disc reads as mottled lunar surface
			// without losing overall brightness.
			float n1 = vnoise(vWorldNormal * 6.0);
			float n2 = vnoise(vWorldNormal * 14.0);
			float crat = clamp(0.78 + n1 * 0.18 + n2 * 0.08, 0.7, 1.05);

			// Mild limb darkening — surface that grazes the camera fades.
			float view = clamp(dot(vWorldNormal, vViewDir), 0.0, 1.0);
			float limb = smoothstep(0.0, 0.55, view);

			// Lit-side gain (1.35) lifts the sunlit hemisphere well above the
			// bloom threshold so the moon reads as a luminous focal point —
			// the brightest object in the night frame — and the bloom halo
			// blooms cleanly off it. The terminator + crescent shape is still
			// fully preserved (lit/crat/limb shape the disc; only the gain on
			// the lit fraction changes). Limb floor lifted 0.60→0.66 so the
			// disc edge doesn't vanish into the black sky.
			vec3 color = uMoonTint * lit * crat * (0.66 + limb * 0.45) * 1.35;
			gl_FragColor = vec4(color, uVisibility);
		}
	`;

	const moonMaterial = new ShaderMaterial({
		vertexShader: VS,
		fragmentShader: FS,
		transparent: true,
		depthWrite: false,
		// depthTest ON so real depth-writing geometry (the wing, ~5-20 m away)
		// occludes the moon. Valid because the shader includes the log-depth
		// chunks (see VS/FS) — the comparison margin is massive (moon at 6e7 m
		// vs wing at <30 m). Clouds stay depthWrite:false so they never occlude.
		// The Earth is NOT in the Three depth buffer; earthOcclusionFactor's
		// opacity fade (useTask below) remains the only Earth occluder.
		depthTest: true,
		uniforms: {
			uSunDir: { value: new Vector3(1, 0, 0) },
			uMoonTint: { value: new Color(0.94, 0.96, 1.0) },
			uVisibility: { value: 0 },
		},
	});

	// Update shader uniforms reactively — reuses the shared sunDir derived.
	//
	// PHASE-TRUE ILLUMINATION: uSunDir is no longer the raw sun direction.
	// Because the moon is PLACED anti-sun, feeding the real sunDir lights the
	// camera-facing hemisphere fully → perpetual full moon. Instead we rotate
	// the illumination direction away from the anti-sun axis by the real
	// date-derived phase angle:
	//
	//   f = moonPhaseFraction(now)   (0 new → 0.5 full → 1 new)
	//   α = π·(1 − 2f)               (full → 0 = lit toward camera;
	//                                 new → π = lit away; sign of α encodes
	//                                 waxing vs waning → crescent side)
	//
	// Rotation axis k = normalize(cross(sunDir, worldUp)) is ⟂ sunDir, so
	// Rodrigues reduces to  v·cosα + (k×v)·sinα. Date-based + deterministic —
	// all 3 Pis render the same phase (invariant #4).
	$effect(() => {
		// Alias contract (invariant #5): computeSunDirection returns a SHARED
		// mutated array. Re-call + read here synchronously rather than reading the
		// `sunDir` $derived — that holds the same reference and another caller's
		// call (EffectStack / Clouds) could have rewritten it before this effect's
		// reactive flush runs, corrupting the phase terminator orientation.
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay);
		const sx = d[0], sy = d[1], sz = d[2];
		const f = moonPhaseFraction(Date.now());
		const alpha = Math.PI * (1 - 2 * f);
		const cosA = Math.cos(alpha);
		const sinA = Math.sin(alpha);
		// k = cross(sun, (0,1,0)) / |…| = (−sz, 0, sx) / h. h = horizontal
		// magnitude of sunDir — never 0 (sunDir y-component is the constant
		// axial-tilt projection, so cos(SUN_TILT) ≈ 0.92 stays horizontal).
		const h = Math.sqrt(sx * sx + sz * sz) || 1;
		// k×sun = (−sx·sy/h, h, −sy·sz/h)  (since k ⟂ sun, |k×sun| = 1)
		const rx = sx * cosA + (-sx * sy / h) * sinA;
		const ry = sy * cosA + h * sinA;
		const rz = sz * cosA + (-sy * sz / h) * sinA;
		moonMaterial.uniforms.uSunDir.value.set(rx, ry, rz);
		moonMaterial.uniforms.uVisibility.value = Math.min(1, moonVisibility);
	});

	$effect(() => () => moonMaterial.dispose());

	// Libration drift + camera-anchored position. We bind refs to both
	// the halo sprite and the body mesh, then in useTask we translate
	// their positions to (cameraPos + moonOffset) each frame. This is
	// the parallax fix described above — the moon stays at fixed
	// apparent direction from the camera regardless of camera world
	// position. Libration rotation is also applied here.
	let moonMesh = $state.raw<Mesh | undefined>();
	let moonHalo = $state.raw<ThreeSprite | undefined>();
	let _libT = 0;
	useTask((dt) => {
		_libT += dt;
		const camPos = ctx.camera.current.position;
		const ox = moonOffset[0];
		const oy = moonOffset[1];
		const oz = moonOffset[2];
		const wx = camPos.x + ox;
		const wy = camPos.y + oy;
		const wz = camPos.z + oz;
		if (moonHalo) moonHalo.position.set(wx, wy, wz);
		if (moonMesh) {
			moonMesh.position.set(wx, wy, wz);
			moonMesh.rotation.y = Math.sin(_libT * 0.029) * 0.08;
			moonMesh.rotation.x = Math.cos(_libT * 0.041) * 0.05;
			moonMesh.rotation.z = Math.sin(_libT * 0.017) * 0.03;
		}

		// Ray-sphere occlusion test against the Earth (see ./occlusion).
		// The moon mesh now depth-tests against Three geometry (the wing),
		// but the Earth lives in CESIUM's depth buffer, not Three's — so this
		// opacity factor remains the ONLY thing that can hide the moon
		// behind the planet.
		//
		// The ray direction is the ACTUAL camera→moon vector (normalised
		// moonOffset) — NOT the assumed `-sunDir`. They were treated as equal,
		// but once any elevation/declination offset is baked into moonOffset the
		// two drift apart, so the test probed the wrong ray and the moon bled
		// straight through the Earth. Deriving the ray from the real offset fixes
		// that by construction.
		const olen = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
		const factor = earthOcclusionFactor(
			camPos.x, camPos.y, camPos.z,
			ox / olen, oy / olen, oz / olen,
			MOON_PLACEMENT_M,
		);
		if (factor !== occlusionFactor) occlusionFactor = factor;
	});

	// Halo — soft cool-blue scatter ring around the moon. Picks up bloom
	// from EffectStack so it reads as a real glow halo, not a painted ring.
	const haloTint = new Color(0.55, 0.62, 0.85);
	const haloTexture = makeRadialTexture([
		[0.00, 'rgba(200, 220, 255, 0.30)'],
		[0.45, 'rgba(170, 190, 230, 0.10)'],
		[1.00, 'rgba(140, 160, 200, 0)'],
	]);

	$effect(() => () => haloTexture.dispose());
</script>

<!-- Halo first so the disc sphere renders on top. Position is set
     in useTask each frame to cameraPos + moonOffset (parallax fix). -->
<T.Sprite
	bind:ref={moonHalo}
	scale={[MOON_HALO_SIZE_M, MOON_HALO_SIZE_M, 1]}
	renderOrder={0}
>
	<!-- depthTest ON: built-in SpriteMaterial handles log depth itself, so the
	     wing's depth writes occlude the halo (clouds don't — depthWrite:false). -->
	<T.SpriteMaterial
		map={haloTexture}
		color={haloTint}
		opacity={moonVisibility * 0.72}
		transparent
		depthWrite={false}
		depthTest={true}
		blending={AdditiveBlending}
	/>
</T.Sprite>

<!-- Moon body — sphere mesh with the custom Lambert + crater shader.
     Position set in useTask each frame (parallax fix). -->
<T.Mesh
	bind:ref={moonMesh}
	renderOrder={1}
	frustumCulled={false}
>
	<T.SphereGeometry args={[MOON_RADIUS_M, 48, 32]} />
	<T is={moonMaterial} />
</T.Mesh>
