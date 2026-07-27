<script lang="ts">
	/**
	 * Rain — falling streak particles with per-particle randomization
	 * and a burst/pause lifecycle so rain comes and goes during a rainy
	 * weather state instead of falling uniformly forever.
	 *
	 * Each particle has its own randomized: size, fall speed, phase
	 * offset, and horizontal sway amplitude. The vertex shader uses
	 * these to give every drop a different streak length, fall rate,
	 * and slight wind-borne wobble — no two drops follow the same path.
	 *
	 * Lifecycle: 45-120 s of rain (BURST_*), then 90-300 s of pause
	 * (PAUSE_*), then another burst. Cycle re-randomizes each pass.
	 * Smooth opacity ramps on transitions so rain fades in/out rather
	 * than snapping.
	 *
	 * Camera-tracked wrapper (same pattern as SparkleField + Meteors)
	 * so the rain volume stays in cabin-space regardless of flight
	 * position. One Points draw call, ~300 particles. Picks up bloom
	 * from EffectStack.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import {
		BufferGeometry,
		BufferAttribute,
		ShaderMaterial,
		AdditiveBlending,
		Points,
		type Group as ThreeGroup,
	} from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { createSeededRng, daySeed } from '$lib/world/prng';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// 400 drops (up from 300) for a denser, more fluid feel — at smaller
	// per-particle size the GPU cost is unchanged (one Points draw call).
	const RAIN_COUNT = 400;
	const X_RANGE = 60;
	const Y_RANGE = 30;
	const Z_RANGE = 60;

	// Burst/pause cycle. Each end-of-burst picks a fresh pause length;
	// each end-of-pause picks a fresh burst length. Irrational ratios
	// in the range constants prevent perceivable cycling.
	const BURST_MIN = 45;
	const BURST_RANGE = 75; // 45–120 s
	const PAUSE_MIN = 90;
	const PAUSE_RANGE = 210; // 90–300 s

	// Per-particle attributes. Pre-randomized so the loop is allocation-
	// free in the vertex shader.
	// 3-Pi panorama determinism: seed with daySeed() so all three Pis
	// generate IDENTICAL droplet layouts. Without seeding, each Pi picks
	// independent positions and the rain seam between adjacent screens
	// is theoretically visible (300 droplets per Pi, mostly invisible at
	// viewing distance but technically breaks the panorama-continuity
	// contract documented in world-three/prng.ts).
	const positions = new Float32Array(RAIN_COUNT * 3);
	const phases = new Float32Array(RAIN_COUNT);
	const sizes = new Float32Array(RAIN_COUNT);
	const speeds = new Float32Array(RAIN_COUNT);
	const sways = new Float32Array(RAIN_COUNT);
	{
		const rng = createSeededRng(daySeed());
		for (let i = 0; i < RAIN_COUNT; i++) {
			positions[i * 3 + 0] = (rng() - 0.5) * X_RANGE;
			positions[i * 3 + 1] = rng() * Y_RANGE;
			positions[i * 3 + 2] = (rng() - 0.5) * Z_RANGE;
			phases[i] = rng();
			// Streak length 3-19 px with a POWER-SKEWED distribution (pow 2.2)
			// instead of the old flat 5-13 uniform — that uniform made every
			// drop nearly the same size (2.6× max/min, clustered mid-range), so
			// the rain read as a wall of identical streaks. The skew puts most
			// drops at the fine 3-6 px end (distant/light) with a long tail of
			// big 15-19 px drops (near/heavy), a 6× spread you actually see —
			// real rain is mostly fine mist with occasional fat close streaks.
			const sizeT = Math.pow(rng(), 2.2);
			// Streak length 3-16 px (power-skewed). Capped shorter than a naive
			// big range: a long streak that falls SLOWLY overlaps its own prior
			// position frame-to-frame and reads as a STANDING vertical line that
			// "stays" instead of a falling drop. The cap + the speed correlation
			// below keep even the big streaks transient.
			sizes[i] = 3 + sizeT * 13;
			// Fall speed correlates with size (motion-blur physics: a faster drop
			// draws a longer streak). The big 1.0-1.7× drops are ALSO the fast
			// ones, so their long streaks sweep down quickly and never linger;
			// the fine 0.85-1.1× drops are short AND slow (drifting mist). One
			// rule gives both the size variation and the no-lingering fix.
			speeds[i] = 0.85 + sizeT * 0.85 + rng() * 0.1;
			// Horizontal sway amplitude 0-1.2 m. Wind-blown wobble.
			sways[i] = rng() * 1.2;
		}
	}
	// NB: The per-event Math.random() at the burst/pause lifecycle (below)
	// is intentionally LEFT live — those are per-Pi event randomness,
	// instantly invisible across the 3-Pi panorama (each Pi enters its
	// own burst at its own time), and don't violate the determinism
	// contract since they're not build-once positions.

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
	geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
	geometry.setAttribute('aSpeed', new BufferAttribute(speeds, 1));
	geometry.setAttribute('aSway', new BufferAttribute(sways, 1));

	const material = new ShaderMaterial({
		transparent: true,
		depthWrite: false,
		depthTest: false,
		blending: AdditiveBlending,
		uniforms: {
			uTime: { value: 0 },
			uVisibility: { value: 0 },
			// 1.15 (was 0.65) — drops now cross the volume in ~0.55-1.0 s (was
			// ~1.0-2.0 s). The slower rate made streaks hang/linger on screen
			// ("the streaks stay for a while"); at this rate each streak sweeps
			// down fast enough to read as a falling drop, not a standing line.
			uFallSpeed: { value: 1.15 },
			uYRange: { value: Y_RANGE },
			uYTop: { value: Y_RANGE * 0.5 },
		},
		vertexShader: /* glsl */ `
			attribute float aPhase;
			attribute float aSize;
			attribute float aSpeed;
			attribute float aSway;
			uniform float uTime;
			uniform float uFallSpeed;
			uniform float uYRange;
			uniform float uYTop;
			void main() {
				vec3 pos = position;
				// Per-particle fall cycle — each drop has its own speed.
				float cycleT = mod(uTime * uFallSpeed * aSpeed + aPhase, 1.0);
				pos.y = uYTop - cycleT * uYRange;
				// Horizontal sway — irrational frequencies + per-particle
				// amplitude so drops drift sideways on wind. Different
				// frequencies on X vs Z mean drops don't all wobble in
				// the same direction.
				pos.x += sin(uTime * 0.9 + aPhase * 13.0) * aSway;
				pos.z += cos(uTime * 1.13 + aPhase * 7.0) * aSway * 0.7;
				vec4 mv = modelViewMatrix * vec4(pos, 1.0);
				gl_Position = projectionMatrix * mv;
				// Per-particle streak length.
				gl_PointSize = aSize;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uVisibility;
			void main() {
				vec2 uv = gl_PointCoord - vec2(0.5, 0.5);
				// 0.06 (was 0.08) — slightly narrower streak (12% of point
				// width visible, was 16%). Combined with smaller PointSize
				// this gives finer-pencil streaks vs chunky lines.
				float xMask = smoothstep(0.06, 0.0, abs(uv.x));
				float yFade = smoothstep(0.5, 0.05, abs(uv.y));
				vec3 color = vec3(0.78, 0.86, 1.0);
				float alpha = xMask * yFade * uVisibility;
				if (alpha < 0.01) discard;
				gl_FragColor = vec4(color, alpha);
			}
		`,
	});

	const points = new Points(geometry, material);
	points.frustumCulled = false;
	points.visible = false; // off by default; JS-gated below

	let group = $state.raw<ThreeGroup | undefined>();

	// Burst/pause state machine.
	let _phase: 'burst' | 'pause' = 'burst';
	let _phaseRemaining = BURST_MIN + Math.random() * BURST_RANGE;

	useTask((dt) => {
		// Lifecycle clock. Advance only when weather actually warrants
		// rain — otherwise the cycle pauses and resumes when weather
		// flips back.
		const w = model.weather;
		const weatherWantsRain = w === 'rain' || w === 'storm';

		if (weatherWantsRain) {
			_phaseRemaining -= dt;
			if (_phaseRemaining <= 0) {
				if (_phase === 'burst') {
					_phase = 'pause';
					_phaseRemaining = PAUSE_MIN + Math.random() * PAUSE_RANGE;
				} else {
					_phase = 'burst';
					_phaseRemaining = BURST_MIN + Math.random() * BURST_RANGE;
				}
			}
		}

		// Target visibility: weather + lifecycle phase.
		const dens = model.effectiveCloudDensity;
		let target = 0;
		if (weatherWantsRain && _phase === 'burst') {
			target = (w === 'storm' ? 0.85 : 0.50) * Math.min(1, dens + 0.4);
		}
		// Smooth approach so phase transitions ease in/out.
		const k = 1 - Math.exp(-dt / 0.8);
		const v = material.uniforms.uVisibility.value + (target - material.uniforms.uVisibility.value) * k;
		material.uniforms.uVisibility.value = v;

		// JS-level gate: skip the 300-particle vertex shader entirely when
		// not raining. Matches the fragment shader's alpha-discard floor.
		const visible = v > 0.01;
		points.visible = visible;
		if (!visible) return;

		material.uniforms.uTime.value += dt;

		if (group) {
			const cam = ctx.camera.current.position;
			group.position.set(cam.x, cam.y, cam.z);
		}
	});

	$effect(() => () => {
		geometry.dispose();
		material.dispose();
	});
</script>

<T.Group bind:ref={group}>
	<T is={points} />
</T.Group>
