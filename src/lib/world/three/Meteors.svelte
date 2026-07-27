<script lang="ts">
	/**
	 * Meteors — rare shooting-star streaks at deep night.
	 * Part of the hybrid artistic layer set (see ThreeOverlay.svelte).
	 *
	 * Discrete event rather than continuous oscillation: at random
	 * intervals (60–240 s) a streak appears at a random point on the
	 * STARS_RADIUS sphere, travels a tangent direction for ~1.2 s, and
	 * fades. Adds the single highest delight-per-line randomness to the
	 * scene — passengers spot one occasionally, the surprise lands.
	 *
	 * Implementation: one Line2 (LineSegments2 family — same screen-space
	 * width neon-line geometry NeonLineLayer uses) representing the
	 * trail. Each meteor:
	 *   - On birth: pick random head position on sphere + random tangent
	 *     direction + random base brightness
	 *   - Per frame: extend trail in direction, fade overall opacity from
	 *     1 → 0 over lifeSec
	 *   - On death: schedule next meteor in random 60-240 s
	 *
	 * Gated by nightFactor (>0.5) — meteors during day would be invisible
	 * against the sky anyway and waste GPU.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import { Vector3, AdditiveBlending } from 'three';
	import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
	import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
	import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { STARS_RADIUS_M } from './state.svelte';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Meteor head travels this far over its life. Was 4.5e8 m (~half the
	// stars-radius), which from a ground/cruise camera subtends ~29° — a
	// real meteor covers 1-5°. Reduced 10× so the streak reads as a real
	// shooting star, not a giant arc across the sky.
	const TRAVEL_M = 4.5e7;
	// Trail behind the head — short, 15% of the travel distance. The head
	// MOVES (real meteors translate across sky); the streak is the brief
	// glowing wake behind it. Previously the head was frozen at the spawn
	// point and only the tail extended, which read as a static bright line.
	const TRAIL_LEN_M = TRAVEL_M * 0.15;
	const LIFE_SEC = 1.2;
	const INTERVAL_MIN_SEC = 60;
	const INTERVAL_RANGE_SEC = 180;

	// Pre-allocated segment buffer (2 endpoints × 3 coords = 6 floats).
	const positions = new Float32Array(6);
	const geometry = new LineSegmentsGeometry();
	geometry.setPositions(positions);

	const material = new LineMaterial({
		color: 0xfff0d0,
		// 1.5 px reads as a delicate streak; 3.0 was paired with the giant
		// arc and bloom amplified it into "too bright" territory. Now that
		// the streak is real-meteor-sized, the narrower line + bloom halo
		// reads as a tasteful glint rather than a flare.
		linewidth: 1.5,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		// depthTest ON so the wing occludes meteor streaks. LineMaterial
		// (three/addons) includes the <logdepthbuf_*> chunks itself, so it
		// compares correctly against the log depth buffer.
		depthTest: true,
	});

	const line = new LineSegments2(geometry, material);
	line.frustumCulled = false;

	// State for the active meteor + scheduling.
	//
	// Determinism (invariant #4): meteor spawn timing + position + direction use
	// live Math.random, NOT createSeededRng — a DELIBERATE exception, unlike the
	// build-once star/cloud/bokeh layouts which must be seeded. Two reasons it's
	// safe for the 3-Pi panorama: (1) a meteor is a rare transient event (60-240s
	// apart), not a persistent layout, so an independent streak per Pi reads fine
	// — there's no static seam to mismatch; (2) true cross-Pi sync is impossible
	// anyway since the Pis have no shared wall-clock origin (they reboot at
	// different times), so seeding the interval sequence wouldn't align spawns.
	const origin = new Vector3();
	const head = new Vector3();
	const dir = new Vector3();
	const tail = new Vector3();
	let life = 0;
	let nextSpawn = 5 + Math.random() * 15; // First meteor between 5-20s

	function spawn() {
		// Random origin on stars-radius sphere — same convention as NightStars.
		const u = Math.random();
		const v = Math.random();
		const theta = 2 * Math.PI * u;
		const phi = Math.acos(2 * v - 1);
		origin.set(
			STARS_RADIUS_M * Math.sin(phi) * Math.cos(theta),
			STARS_RADIUS_M * Math.cos(phi),
			STARS_RADIUS_M * Math.sin(phi) * Math.sin(theta),
		);
		// Random tangent direction — any direction perpendicular-ish to
		// the radius. Picking a random vector and projecting out the
		// radial component gives a clean tangent.
		const radial = origin.clone().normalize();
		dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
		dir.addScaledVector(radial, -dir.dot(radial)); // subtract radial component
		dir.normalize();
		life = LIFE_SEC;
	}

	// Keep LineMaterial resolution in sync with the renderer so the
	// screen-space line width stays correct on resize.
	$effect(() => {
		const { width, height } = ctx.size.current;
		material.resolution.set(width, height);
	});

	useTask((dt) => {
		// Visibility gate — only fire meteors at deep night.
		// Reset in-flight meteor when day breaks: a frozen life var
		// would resume mid-flight next night cycle, producing a visual
		// pop at the old head position.
		const nf = model.nightFactor;
		if (nf < 0.5) {
			life = 0;
			material.opacity = 0;
			return;
		}

		if (life <= 0) {
			nextSpawn -= dt;
			material.opacity = 0;
			if (nextSpawn <= 0) {
				spawn();
				nextSpawn = INTERVAL_MIN_SEC + Math.random() * INTERVAL_RANGE_SEC;
			}
			return;
		}

		// Clamp: tab-hidden or long frames could push life deeply negative,
		// which blows ageNorm past 1.0 and the tail beyond the far plane.
		life = Math.max(0, life - dt);
		const ageNorm = 1 - life / LIFE_SEC; // 0 → 1 over lifetime

		// Head TRANSLATES from origin in `dir` over the meteor's life.
		// At ageNorm=0 head sits at origin; at ageNorm=1 it has covered
		// TRAVEL_M. Real meteors move across the sky — previously the head
		// was anchored at spawn, only the tail extended, producing a static
		// bright line that read as a rendering artifact.
		head.copy(origin).addScaledVector(dir, TRAVEL_M * ageNorm);
		// Tail follows behind head by a short fixed offset — the brief
		// glowing wake. Short trail = real-meteor look, not giant arc.
		tail.copy(head).addScaledVector(dir, -TRAIL_LEN_M);

		// Direct attribute mutation instead of setPositions() — avoids
		// a new GPU buffer allocation (BufferAttribute) every frame.
		const posAttr = geometry.attributes.position;
		posAttr.setXYZ(0, head.x, head.y, head.z);
		posAttr.setXYZ(1, tail.x, tail.y, tail.z);
		posAttr.needsUpdate = true;

		// Opacity: full at birth, ramps down faster than ageNorm so the
		// streak dims quickly after the peak (asymmetric envelope).
		const fade = Math.max(0, 1 - ageNorm * ageNorm * 1.4);
		material.opacity = fade * Math.min(1, (nf - 0.5) * 2);
	});

	$effect(() => () => {
		geometry.dispose();
		material.dispose();
	});
</script>

<T is={line} />
