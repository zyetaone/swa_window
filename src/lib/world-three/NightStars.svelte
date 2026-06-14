<script lang="ts">
	/**
	 * NightStars — twinkling additive star field, visible at deep night.
	 *
	 * Three.js Points + ShaderMaterial. Per-star phase offset attribute
	 * drives a sin() twinkle in the vertex shader; uTime is bumped by
	 * useTask each frame. Fades in with model.nightFactor so the stars
	 * only assert themselves once Cesium's sky is dark enough not to
	 * wash them out.
	 *
	 * Lives on top of Cesium's own celestial sphere. Cesium's stars are
	 * essentially static — these twinkle and add depth across the deep-
	 * night window of the show.
	 */
	import { T, useTask } from '@threlte/core';
	import {
		BufferGeometry,
		BufferAttribute,
		AdditiveBlending,
		ShaderMaterial,
		Points,
	} from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { STARS_RADIUS_M, EARTH_RADIUS_M, OCCLUSION_SOFTNESS_M } from './state.svelte';
	import { airMassFactor } from './sky';
	import { lightingState } from './lighting';
	import { createSeededRng, daySeed, spherePoint } from './prng';

	const model = useAeroWindow();

	let {
		ambientIntensity = 1,
	}: {
		ambientIntensity?: number;
	} = $props();

	const STAR_COUNT = 1800;

	// Spectral-class palette (approximate Bayer distribution). Cumulative
	// probabilities + tints — realistic mix is M-class red dwarves
	// dominant (~60%), G-class sun-like ~20%, A/F white ~15%, O/B blue
	// rare ~5%. The night sky reads with proper colour variance instead
	// of a uniform white twinkle.
	type SpectralClass = { tint: [number, number, number]; cumulativeP: number };
	const SPECTRAL: SpectralClass[] = [
		{ tint: [1.00, 0.70, 0.50], cumulativeP: 0.60 }, // M/K — warm orange/red
		{ tint: [1.00, 0.92, 0.78], cumulativeP: 0.80 }, // G — sun-yellow
		{ tint: [0.95, 0.96, 1.00], cumulativeP: 0.95 }, // A/F — white
		{ tint: [0.78, 0.88, 1.00], cumulativeP: 1.00 }, // O/B — blue-white
	];

	function pickSpectralTint(rng: () => number): [number, number, number] {
		const r = rng();
		for (const s of SPECTRAL) if (r <= s.cumulativeP) return s.tint;
		return SPECTRAL[SPECTRAL.length - 1].tint;
	}

	// Pre-allocate position + per-star phase + magnitude + spectral colour.
	// Seeded with daySeed() so all three Pis in a 3-Pi panorama see the
	// SAME star positions on the same day (continuous sky across screens).
	// Day rolls over → new seed → fresh constellation arrangement.
	// Per-frame twinkle phase advance stays live (uTime in shader) so
	// individual Pis don't synchronise their oscillation, only the
	// underlying star positions.
	// Milky Way — route a fraction of the stars into a tilted galactic-plane
	// BAND (a great circle with a soft ±~11° gaussian spread) instead of the
	// uniform sphere. This paints the faint "river of stars" across the sky
	// purely as star DENSITY — no glow band (we just removed those), so it's
	// safe: it's only more, dimmer points clustered along a plane, which bloom
	// fuses into a soft haze. Deterministic (same seeded rng → same band on
	// every Pi). MW_TILT crosses the band diagonally so it's not horizon-flat.
	const MW_FRACTION = 0.42;
	const MW_TILT = 1.05; // rad — galactic-plane inclination in world frame
	const MW_HALFWIDTH = 0.19; // rad — band thickness (~11°)
	const cosTilt = Math.cos(MW_TILT), sinTilt = Math.sin(MW_TILT);
	function milkyWayPoint(r: () => number, radius: number): [number, number, number] {
		const alpha = 2 * Math.PI * r(); // along the band
		// Sum-of-uniforms ≈ gaussian latitude, concentrated on the plane.
		const g = r() + r() + r() - 1.5;
		const beta = g * MW_HALFWIDTH;
		const cb = Math.cos(beta);
		const dx = cb * Math.cos(alpha);
		const dy = Math.sin(beta);
		const dz = cb * Math.sin(alpha);
		// Tilt about X so the band sweeps diagonally across the dome.
		return [dx * radius, (dy * cosTilt - dz * sinTilt) * radius, (dy * sinTilt + dz * cosTilt) * radius];
	}

	const rng = createSeededRng(daySeed());
	const positions = new Float32Array(STAR_COUNT * 3);
	const phases = new Float32Array(STAR_COUNT);
	const magnitudes = new Float32Array(STAR_COUNT);
	const colors = new Float32Array(STAR_COUNT * 3);
	for (let i = 0; i < STAR_COUNT; i++) {
		// Band stars: clustered on the galactic plane + biased FAINT (the Milky
		// Way reads as a haze of dim stars, not bright ones — the hero stars
		// stay in the uniform field). Field stars: uniform sphere, cubic-dim.
		const inBand = rng() < MW_FRACTION;
		const [x, y, z] = inBand
			? milkyWayPoint(rng, STARS_RADIUS_M)
			: spherePoint(rng, STARS_RADIUS_M);
		positions[i * 3 + 0] = x;
		positions[i * 3 + 1] = y;
		positions[i * 3 + 2] = z;
		phases[i] = rng() * Math.PI * 2;
		const m = inBand ? Math.pow(rng(), 5) * 0.55 : Math.pow(rng(), 3);
		magnitudes[i] = m;
		const tint = pickSpectralTint(rng);
		colors[i * 3 + 0] = tint[0];
		colors[i * 3 + 1] = tint[1];
		colors[i * 3 + 2] = tint[2];
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
	geometry.setAttribute('aMagnitude', new BufferAttribute(magnitudes, 1));
	geometry.setAttribute('aColor', new BufferAttribute(colors, 3));

	const material = new ShaderMaterial({
		transparent: true,
		depthWrite: false,
		// depthTest ON so the wing (the only depth-writing Three geometry)
		// occludes stars. Requires the <logdepthbuf_*> chunks below — the
		// renderer is logarithmicDepthBuffer, so a custom shader only compares
		// depth correctly if it computes the same log encoding. Clouds are
		// depthWrite:false and can never occlude. The Earth isn't in the Three
		// depth buffer; the per-star horizon fade (vertex shader) handles it.
		depthTest: true,
		blending: AdditiveBlending,
		uniforms: {
			uTime: { value: 0 },
			uVisibility: { value: 0 },
			uNightFactor: { value: 0 },
		},
		vertexShader: /* glsl */ `
			#include <common>
			#include <logdepthbuf_pars_vertex>
			attribute float aPhase;
			attribute float aMagnitude;
			attribute vec3 aColor;
			uniform float uTime;
			uniform float uVisibility;
			uniform float uNightFactor;
			varying float vAlpha;
			varying vec3 vColor;
			// Earth geometry for the per-star horizon fade — compile-time
			// constants from state.svelte.ts (deterministic, zero JS/frame).
			const float EARTH_R_M = ${EARTH_RADIUS_M.toFixed(1)};
			const float SOFTNESS_M = ${OCCLUSION_SOFTNESS_M.toFixed(1)};
			void main() {
				// Twinkle: bright stars twinkle more (eye's refraction
				// sensitivity correlates with apparent magnitude).
				// Two irrational frequencies prevent visible cycle.
				float twinkleBase = sin(uTime * 0.9 + aPhase * 3.0);
				float twinkleFast = sin(uTime * 2.7 + aPhase * 7.13);
				// Dim stars barely twinkle (~6% flicker); bright stars
				// twinkle dramatically (~50%). Matches real eye refraction
				// sensitivity which scales with apparent magnitude.
				float twinkleAmp = 0.06 + aMagnitude * 0.45;
				float twinkle = 1.0 + twinkleAmp * (0.7 * twinkleBase + 0.3 * twinkleFast);
				// Magnitude-driven brightness — dim stars stay dim, bright
				// stars punch (and bloom in EffectStack). The mid/bright tail
				// is curved UP (aMagnitude^0.8 boost) so prominent stars
				// genuinely shine against the now-clean black sky, while the
				// faint floor (0.22) keeps the dust subtle but perceptible —
				// the magnitude hierarchy is preserved, just with more contrast.
				float bright = 0.22 + pow(aMagnitude, 0.8) * 1.55;

				// Per-star magnitude-gated fade-in. This is how a real night
				// sky reveals itself: bright planets/stars (Vega, Sirius)
				// appear first at civil twilight; mid-magnitude stars phase
				// in as the sky darkens; the faintest only at deep dark.
				// Threshold is linear in magnitude:
				//   - aMag = 1.0 (brightest) → threshold 0.18 (civil twilight)
				//   - aMag = 0.5 (mid)       → threshold ~0.52
				//   - aMag = 0.0 (faintest)  → threshold 0.85 (only deep night)
				// 0.12 smoothstep width gives ~2 min of fade across the
				// real-time-sync cycle — passengers see stars phase in,
				// not all appear at once. Bright-star floor lowered 0.30 →
				// 0.18 so Vega/Sirius show through the blue hour, matching
				// what passengers actually see from a window seat at dusk.
				float starThreshold = 0.18 + (1.0 - aMagnitude) * 0.67;
				float starFade = smoothstep(starThreshold, starThreshold + 0.12, uNightFactor);

				// ── Earth-limb horizon fade ──────────────────────────────
				// Stars are distributed over the FULL sphere at STARS_RADIUS_M,
				// so roughly half would otherwise shine THROUGH the planet (the
				// Earth lives in Cesium's depth buffer, not Three's). GLSL port
				// of occlusion.ts's ray-sphere test against the Earth at the
				// world origin: star distance (5e8 m) >> Earth, so the
				// "intersection beyond the object" branch drops out — the star
				// is occluded iff the ray hits the sphere ahead of the camera.
				// Soft fade over the OCCLUSION_SOFTNESS_M limb band (no pop at
				// the horizon — same band the moon/Venus fades use).
				vec3 starWorld = (modelMatrix * vec4(position, 1.0)).xyz;
				vec3 starDir = normalize(starWorld - cameraPosition);
				float b = dot(cameraPosition, starDir);
				float camLenSq = dot(cameraPosition, cameraPosition);
				float disc = b * b - (camLenSq - EARTH_R_M * EARTH_R_M);
				float horizonFade = 1.0;
				if (disc >= 0.0 && (sqrt(disc) - b) > 0.0) {
					float closestApproach = sqrt(max(0.0, camLenSq - b * b));
					horizonFade = clamp(
						0.5 + (closestApproach - EARTH_R_M) / SOFTNESS_M, 0.0, 1.0);
				}

				vAlpha = uVisibility * twinkle * bright * starFade * horizonFade;
				vColor = aColor;
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				gl_Position = projectionMatrix * mv;
				#include <logdepthbuf_vertex>
				// Size scales with magnitude: 1.5 px for the dimmest stars,
				// ~6.2 px for the brightest — the brightest read as distinct
				// bright points and bloom strongly. Curved (^0.7) so the size
				// boost concentrates on the prominent stars, not the faint dust.
				gl_PointSize = 1.5 + pow(aMagnitude, 0.7) * 4.7;
			}
		`,
		fragmentShader: /* glsl */ `
			#include <logdepthbuf_pars_fragment>
			varying float vAlpha;
			varying vec3 vColor;
			void main() {
				#include <logdepthbuf_fragment>
				vec2 uv = gl_PointCoord - 0.5;
				float d = length(uv);
				// Soft round disk via smoothstep, with a tight inner core
				// so bright stars get a hot centre that picks up bloom.
				float disk = smoothstep(0.5, 0.05, d);
				float core = smoothstep(0.18, 0.0, d);
				vec3 c = vColor * (1.0 + core * 0.5);
				gl_FragColor = vec4(c, disk * vAlpha);
			}
		`,
	});

	const points = new Points(geometry, material);

	useTask((dt) => {
		material.uniforms.uTime.value += dt;
		// Only assert at deep night — nightFactor → ~1.0. Cesium's own
		// stars cover the dusk transition; these are the deep-night punch.
		// Slight airMass + ambient harmony modulation.
		const am = airMassFactor(model.flight.camLat, model.timeOfDay);
		const amFactor = 1 + Math.min(0.4, (am - 1) * 0.08);
		const ai = ambientIntensity ?? 1;
		// Star ramp from the unified lighting SSOT. lightingState returns a
		// SHARED mutated object — read the scalar in the same expression,
		// never store the reference.
		material.uniforms.uVisibility.value =
			lightingState(model.timeOfDay, model.nightFactor).starVisibility * amFactor * ai;
		// Raw nightFactor for the per-star magnitude-gated fade-in (vertex shader).
		// uVisibility handles env modulation (airMass, ambient); uNightFactor
		// drives the "first stars appear, more reveal as it darkens" cinematic.
		material.uniforms.uNightFactor.value = model.nightFactor;
	});

	$effect(() => () => {
		geometry.dispose();
		material.dispose();
	});
</script>

<T is={points} />
