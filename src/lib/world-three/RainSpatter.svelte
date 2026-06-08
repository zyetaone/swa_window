<script lang="ts">
	/**
	 * RainSpatter — procedural raindrops ON THE WINDOW GLASS.
	 *
	 * A single fullscreen quad mounted at the camera's near plane (so it
	 * fills the view at all times), with a fragment shader that procedurally
	 * draws circular droplets at random screen positions, each with its own
	 * birth time + growing radius + fade. No texture asset; everything is
	 * computed from a hash of grid-cell coordinates.
	 *
	 * Visibility tracks the same weather/lifecycle signals as Rain.svelte
	 * (rain/storm + burst phase) so the spatter only appears during
	 * active rain bursts and fades cleanly on pause.
	 *
	 * One quad → one draw call → trivial GPU cost.
	 *
	 * The quad is anchored to camera near plane via T.Group ref + per-frame
	 * sync to camera world transform — keeps it locked in front of the
	 * eye regardless of camera motion.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import {
		PlaneGeometry,
		ShaderMaterial,
		Mesh,
		Vector3,
		Quaternion,
	} from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Burst lifecycle (independent of Rain.svelte's; both run side-by-side
	// without coupling — they share the weather signal).
	const BURST_MIN = 45;
	const BURST_RANGE = 75;
	const PAUSE_MIN = 90;
	const PAUSE_RANGE = 210;

	const material = new ShaderMaterial({
		transparent: true,
		depthWrite: false,
		depthTest: false,
		uniforms: {
			uTime: { value: 0 },
			uVisibility: { value: 0 },
		},
		vertexShader: /* glsl */ `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uTime;
			uniform float uVisibility;
			varying vec2 vUv;

			float hash(vec2 p) {
				return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
			}

			// Render drops by sampling grid cells. To avoid a visible
			// grid pattern, only ~45% of cells host a drop (the rest
			// stay empty), and within each active cell the drop center
			// uses wide intra-cell jitter (0.15–0.85 vs the prior
			// 0.25–0.75). Together they break up the row/column reads
			// the eye was picking up before.
			float dropAt(vec2 uv, float cellSize, float seed) {
				vec2 grid = uv / cellSize;
				vec2 cell = floor(grid);
				vec2 cellUv = fract(grid);

				// Per-cell existence gate — ~45% of cells host a drop, rest
				// stay empty. Kills the gridded "evenly spaced drops" look.
				float present = step(0.55, hash(cell + seed + 99.0));
				if (present < 0.5) return 0.0;

				// Per-cell random center — wider jitter range (0.15–0.85)
				// breaks alignment between adjacent cells.
				vec2 center = vec2(
					0.15 + hash(cell + seed) * 0.7,
					0.15 + hash(cell + seed + 7.3) * 0.7
				);

				// Per-cell birth time + cycle period. 0.45 (was 0.26) —
				// noticeably faster drop turnover so the spatter feels
				// alive: drops appear, grow, fade, gone in ~2.2s vs the
				// prior ~3.8s cycle. Reads as constant fresh rain rather
				// than slow languid droplets.
				float birth = hash(cell + seed + 13.7);
				float age = mod(uTime * 0.45 + birth, 1.0);

				// Droplet grows then dissipates. Tiny radius for fine
				// pinprick droplets — was 0.04 + age * 0.12, now 0.025 +
				// age * 0.07, about half the size at peak.
				float radius = 0.025 + age * 0.07;
				float dist = length(cellUv - center);
				float ring = smoothstep(radius, radius - 0.015, dist);
				float fade = (1.0 - age) * smoothstep(0.05, 0.3, age);
				return ring * fade;
			}

			void main() {
				// Two grid layers at larger cell sizes (was 0.11 + 0.07)
				// for lower density. Combined with the ~45% per-cell gate
				// inside dropAt(), effective density is ~25% of what it
				// was — sparse spatter that reads as random drops on
				// glass rather than a regular pattern.
				float d1 = dropAt(vUv, 0.17, 0.0);
				float d2 = dropAt(vUv, 0.12, 5.7);
				float drops = max(d1, d2 * 0.85);

				// Cool blue-grey droplets, subtle. Alpha multiplier 0.18
				// (was 0.32) — drops are barely-there hints on glass
				// rather than visible water marks. The bloom pass will
				// still pick up the brightest peaks softly.
				vec3 color = vec3(0.55, 0.65, 0.78);
				float alpha = drops * uVisibility * 0.18;
				if (alpha < 0.005) discard;
				gl_FragColor = vec4(color, alpha);
			}
		`,
	});

	// Quad sized to cover the camera near-plane frustum at distance NEAR.
	// For a 45° fov + near=100, half-height at near = 100 × tan(22.5°) ≈ 41.4.
	// Make the quad slightly larger and place it at near + 1 m so it stays
	// in front of everything.
	const NEAR_DIST = 150;
	const quadGeom = new PlaneGeometry(200, 200);
	const quadMesh = new Mesh(quadGeom, material);
	quadMesh.frustumCulled = false;
	quadMesh.renderOrder = 999; // drawn last, on top of everything

	const _quat = new Quaternion();
	const _fwd = new Vector3();
	const _pos = new Vector3();

	let _phase: 'burst' | 'pause' = 'burst';
	let _phaseRemaining = BURST_MIN + Math.random() * BURST_RANGE;

	useTask((dt) => {
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

		let target = 0;
		if (weatherWantsRain && _phase === 'burst') {
			target = w === 'storm' ? 0.95 : 0.65;
		}
		const k = 1 - Math.exp(-dt / 0.8);
		const v = material.uniforms.uVisibility.value + (target - material.uniforms.uVisibility.value) * k;
		material.uniforms.uVisibility.value = v;

		// JS-level visibility gate — when not raining, hide the mesh entirely
		// so the renderer skips the fullscreen procedural shader pass. Saves
		// ~1-2 ms on Pi 5 during clear/cloudy weather (which is most of the
		// time). Threshold matches the fragment shader's `discard` floor.
		const visible = v > 0.01;
		quadMesh.visible = visible;
		if (!visible) return;

		material.uniforms.uTime.value += dt;

		// Anchor quad to camera near-plane each frame. We orient by camera
		// quaternion and place it NEAR_DIST in front of the camera.
		const cam = ctx.camera.current;
		_quat.copy(cam.quaternion);
		_fwd.set(0, 0, -1).applyQuaternion(_quat);
		_pos.copy(cam.position).addScaledVector(_fwd, NEAR_DIST);
		quadMesh.position.copy(_pos);
		quadMesh.quaternion.copy(_quat);
	});

	$effect(() => () => {
		quadGeom.dispose();
		material.dispose();
	});
</script>

<T is={quadMesh} />
