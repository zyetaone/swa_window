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

	const TRAIL_LEN_M = 4.5e8; // ~half the stars-radius
	const LIFE_SEC = 1.2;
	const INTERVAL_MIN_SEC = 60;
	const INTERVAL_RANGE_SEC = 180;

	// Pre-allocated segment buffer (2 endpoints × 3 coords = 6 floats).
	const positions = new Float32Array(6);
	const geometry = new LineSegmentsGeometry();
	geometry.setPositions(positions);

	const material = new LineMaterial({
		color: 0xfff0d0,
		// 1.5 px was easy to miss for a once-per-minute event. 3.0 px
		// gives the streak enough visual weight to register at viewer
		// distance + bloom across the streak head amplifies it further.
		linewidth: 3.0,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		depthTest: false,
	});

	const line = new LineSegments2(geometry, material);
	line.frustumCulled = false;

	// State for the active meteor + scheduling.
	const head = new Vector3();
	const dir = new Vector3();
	const tail = new Vector3();
	let life = 0;
	let nextSpawn = 5 + Math.random() * 15; // First meteor between 5-20s

	function spawn() {
		// Random head on stars-radius sphere — same convention as NightStars.
		const u = Math.random();
		const v = Math.random();
		const theta = 2 * Math.PI * u;
		const phi = Math.acos(2 * v - 1);
		head.set(
			STARS_RADIUS_M * Math.sin(phi) * Math.cos(theta),
			STARS_RADIUS_M * Math.cos(phi),
			STARS_RADIUS_M * Math.sin(phi) * Math.sin(theta),
		);
		// Random tangent direction — any direction perpendicular-ish to
		// the radius. Picking a random vector and projecting out the
		// radial component gives a clean tangent.
		const radial = head.clone().normalize();
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
		const nf = model.nightFactor;
		if (nf < 0.5) {
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

		life -= dt;
		const ageNorm = 1 - life / LIFE_SEC; // 0 → 1 over lifetime

		// Trail extends as the meteor ages; fades out near end.
		tail.copy(head).addScaledVector(dir, -TRAIL_LEN_M * ageNorm);

		positions[0] = head.x; positions[1] = head.y; positions[2] = head.z;
		positions[3] = tail.x; positions[4] = tail.y; positions[5] = tail.z;
		geometry.setPositions(positions);

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
