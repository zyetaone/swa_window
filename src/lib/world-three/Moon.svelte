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
	 * Geometry simplification: moon_pos = −sunDir × placement. Camera is
	 * always on the Earth side of this line, so Lambert math gives the
	 * camera-facing hemisphere lit → reads as full moon. Real lunar
	 * phases would require modeling the moon's orbit; this approximation
	 * matches the "moon comes out at night" feel passengers expect.
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
	import { computeSunDirection, SUN_PLACEMENT_M } from './sky';
	import { makeRadialTexture } from './texture-util';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Moon mirrors the sun's placement radius (same as SUN_PLACEMENT_M
	// from sky.ts) on the anti-sun side. Aliased here for clarity but
	// reads from the single source of truth.
	const MOON_PLACEMENT_M = SUN_PLACEMENT_M;
	const MOON_RADIUS_M = 2.0e6;
	const MOON_HALO_SIZE_M = MOON_RADIUS_M * 8;

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

	const airMassFactor = $derived.by(() => {
		const moonElev = Math.max(-0.12, Math.min(1, -sunDir[1]));
		return 1.0 / Math.max(0.12, moonElev + 0.12);
	});

	// Ray-sphere occlusion against Earth. Updated each frame in useTask
	// since it depends on camera world position, not just sun direction.
	// 0 = moon hidden by Earth, 1 = moon visible. Smooth fade across the
	// terminator via the radial-vs-earth-radius softness band.
	let earthOcclusionFactor = $state(1);

	const moonVisibility = $derived.by(() => {
		const nfGate = Math.max(0, model.nightFactor - 0.15) * 1.18;
		const horizonBoost = 1 + Math.min(0.9, (airMassFactor - 1) * 0.22);
		// Multiply by Earth-occlusion factor (computed per frame in useTask
		// below). The previous `Math.max(0, -sunDir[1])` gate was wrong: in
		// sky.ts, sunDir[1] = sin(SUN_TILT) ≈ +0.397 is a CONSTANT axial-
		// tilt projection, not a camera-local altitude — so the gate would
		// have always zeroed the moon. Proper ray-sphere math against the
		// real camera position handles oblique angles + multi-Pi parallax.
		return nfGate * horizonBoost * earthOcclusionFactor;
	});

	const VS = /* glsl */ `
		varying vec3 vWorldNormal;
		varying vec3 vViewDir;
		void main() {
			vec4 worldPos = modelMatrix * vec4(position, 1.0);
			vWorldNormal = normalize(mat3(modelMatrix) * normal);
			vViewDir = normalize(cameraPosition - worldPos.xyz);
			gl_Position = projectionMatrix * viewMatrix * worldPos;
		}
	`;

	const FS = /* glsl */ `
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

			vec3 color = uMoonTint * lit * crat * (0.60 + limb * 0.45);
			gl_FragColor = vec4(color, uVisibility);
		}
	`;

	const moonMaterial = new ShaderMaterial({
		vertexShader: VS,
		fragmentShader: FS,
		transparent: true,
		depthWrite: false,
		depthTest: false,
		uniforms: {
			uSunDir: { value: new Vector3(1, 0, 0) },
			uMoonTint: { value: new Color(0.94, 0.96, 1.0) },
			uVisibility: { value: 0 },
		},
	});

	// Update shader uniforms reactively — reuses the shared sunDir derived.
	$effect(() => {
		moonMaterial.uniforms.uSunDir.value.set(sunDir[0], sunDir[1], sunDir[2]);
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
	// WGS84 mean Earth radius. Slightly tighter than the equatorial
	// 6.378e6 — using mean radius gives consistent occlusion across
	// latitudes without per-frame ellipsoid sampling cost.
	const EARTH_RADIUS_M = 6.371e6;
	// Softness band: a smoothstep ramp around the Earth tangent so the
	// moon fades rather than pops as it crosses the horizon. 60 km of
	// soft band reads as a 1-2 second fade at orbital cruise speeds.
	const OCCLUSION_SOFTNESS_M = 6e4;
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

		// Ray-sphere occlusion test. Ray origin = camera (world coords),
		// direction = normalised moonOffset (= -sunDir, already unit-length),
		// length = MOON_PLACEMENT_M. Sphere = Earth at origin, radius
		// EARTH_RADIUS_M. Solve t² + 2(cP·dir)t + (|cP|² - R²) = 0.
		// If the smaller positive root falls before the moon, Earth is
		// between camera and moon → occluded.
		const dx = -sunDir[0], dy = -sunDir[1], dz = -sunDir[2];
		const b = camPos.x * dx + camPos.y * dy + camPos.z * dz;
		const camLenSq = camPos.x * camPos.x + camPos.y * camPos.y + camPos.z * camPos.z;
		const c = camLenSq - EARTH_RADIUS_M * EARTH_RADIUS_M;
		const disc = b * b - c;
		let factor = 1;
		if (disc >= 0) {
			const sq = Math.sqrt(disc);
			const tEntry = -b - sq;
			if (tEntry > 0 && tEntry < MOON_PLACEMENT_M) {
				// Soft fade: distance from ray to Earth's edge. Inside Earth
				// shadow by more than OCCLUSION_SOFTNESS_M → fully hidden.
				// At the tangent → 0.5. Just outside → fully visible.
				const closestApproach = Math.sqrt(Math.max(0, camLenSq - b * b));
				const edgeDistance = closestApproach - EARTH_RADIUS_M;
				factor = Math.max(0, Math.min(1, 0.5 + edgeDistance / OCCLUSION_SOFTNESS_M));
			}
		}
		if (factor !== earthOcclusionFactor) earthOcclusionFactor = factor;
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
	<T.SpriteMaterial
		map={haloTexture}
		color={haloTint}
		opacity={moonVisibility * 0.55}
		transparent
		depthWrite={false}
		depthTest={false}
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
