<script lang="ts">
	/**
	 * Wing contrail — a faint white trail extending backward from where
	 * the right wing would be in the passenger's view.
	 *
	 * Why this matters: the single most iconic "you are on a plane" detail
	 * the current stack is missing. Nothing else places you in a moving
	 * aircraft as immediately as a contrail visible through the window.
	 *
	 * Implementation:
	 *   - A Line2 (LineSegmentsGeometry / LineMaterial) so the width is
	 *     screen-space — stays readable at any camera distance.
	 *   - Camera-anchored via a Group whose position + quaternion mirror
	 *     the camera each frame. Vertices live in camera-LOCAL space at
	 *     fixed offsets (right of camera, behind camera) so the trail
	 *     always sits where the right wing would be.
	 *   - Gentle downward curve mid-trail (gravity sag of condensed
	 *     ice crystals).
	 *   - Per-vertex alpha fades white→transparent along its length.
	 *   - Visibility gated by altitude > 26000 ft (contrails only form
	 *     where the air is cold enough — below cruise, the moisture
	 *     vaporises faster than ice can form). Smooth ramp to avoid pop.
	 *   - Hidden during cruise warp transition (warpFactor > 0) — a
	 *     contrail seen during a teleport would look weird.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import {
		AdditiveBlending,
		type Group as ThreeGroup,
	} from 'three';
	import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
	import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
	import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Trail offsets in CAMERA-LOCAL coordinates. The camera-mirror group
	// inherits the camera's world transform, so these stay where the
	// wing would be.
	//
	//   x+ → camera right    → wing is on the right
	//   y- → camera down     → wing is slightly below sight-line
	//   z- → camera forward  → trail extends into the visible scene
	//                          (Three.js convention: forward = -z, so
	//                          this is the direction passengers SEE)
	//
	// Aside on physical accuracy: a real contrail trails BEHIND the
	// aircraft, which in camera-local terms is +z (behind the eye, not
	// rendered). To keep the contrail VISIBLE in the kiosk's orbit-camera
	// modes (no concrete flight direction), we draw it extending into the
	// camera's forward-right hemisphere — read as "the air the wing just
	// moved through, seen by the passenger looking out the window." Not
	// strictly accurate physics, but it lands the "you are on a plane"
	// cue passengers actually want, and stays consistent under all camera
	// orientations the kiosk uses.
	//
	// 8 m right, 1.5 m below — roughly where a 737-class wing tip sits
	// relative to a window-row passenger's eye line.
	const WING_X = 8;
	const WING_Y = -1.5;
	// Trail length: 600 m feels right at cruise. Real contrails extend
	// many kilometres but the visible portion in a window is ~the first
	// few hundred metres before atmospheric perspective swallows them.
	const TRAIL_LEN = 600;
	const SEGMENTS = 24;

	// Build line segments. Each consecutive pair of vertices becomes one
	// drawn segment (LineSegmentsGeometry needs paired endpoints).
	// We bake gravity sag + per-vertex alpha into positions/colors here
	// since they never change in camera-local space.
	const positions: number[] = [];
	const colors: number[] = [];
	for (let i = 0; i < SEGMENTS; i++) {
		const t0 = i / SEGMENTS;
		const t1 = (i + 1) / SEGMENTS;
		for (const t of [t0, t1]) {
			// Gravity sag — parabolic dip mid-trail. ~1.5 m sag at midpoint.
			const sag = -1.5 * 4 * t * (1 - t);
			// Slight outward drift — contrail spreads behind the wing.
			const xDrift = WING_X + 0.6 * t;
			// -z = camera forward in Three.js convention. Vertex extends
			// into the visible scene (see file-level "Aside on physical
			// accuracy" note for the kiosk-specific trade-off).
			positions.push(xDrift, WING_Y + sag, -TRAIL_LEN * t);
			// Per-vertex color stores fade-out. Brightest at vertex 0
			// (close to wing), fades to transparent at the trail end.
			const fade = Math.pow(1 - t, 1.4);
			colors.push(fade, fade, fade);
		}
	}

	const geometry = new LineSegmentsGeometry();
	geometry.setPositions(new Float32Array(positions));
	geometry.setColors(new Float32Array(colors));

	const material = new LineMaterial({
		// Screen-space width — stays the same pixel count at any distance.
		// 2.5 px reads as a "thin pencil line" — large enough to register
		// at viewing distance, narrow enough to feel atmospheric.
		linewidth: 2.5,
		vertexColors: true,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		depthTest: false,
		// fog: false — contrail is camera-anchored so distance-based fog
		// would look wrong (the trail is "near" but baked far).
		fog: false,
	});

	const line = new LineSegments2(geometry, material);
	line.frustumCulled = false;

	let group = $state.raw<ThreeGroup | undefined>();

	// LineMaterial needs viewport resolution to render screen-space width.
	$effect(() => {
		const { width, height } = ctx.size.current;
		material.resolution.set(width, height);
	});

	useTask((dt) => {
		// Altitude visibility gate — contrails only form above ~26k ft
		// where air is cold and humid enough for the engine exhaust to
		// condense. Soft 4 kft ramp avoids on/off pop.
		const alt = model.flight.altitude;
		const altRamp = Math.max(0, Math.min(1, (alt - 26000) / 4000));
		// Hide during cruise warp transition (teleport) — contrail through
		// a non-physical scene cut would look broken.
		const warpGate = 1 - Math.min(1, model.flight.warpFactor * 3);
		// Smooth opacity tween (k matches motion engine's smoothing).
		const target = altRamp * warpGate;
		const k = 1 - Math.exp(-dt / 0.8);
		material.opacity += (target - material.opacity) * k;

		// JS-level visibility — skip the screen-space line draw entirely
		// at low altitude. Matches the Rain/RainSpatter gating pattern.
		const visible = material.opacity > 0.005;
		line.visible = visible;
		if (!visible) return;

		// Mirror the camera world transform onto the group so the trail
		// sits in camera-local space without us doing per-vertex math.
		if (group) {
			const cam = ctx.camera.current;
			group.position.copy(cam.position);
			group.quaternion.copy(cam.quaternion);
		}
	});

	$effect(() => () => {
		geometry.dispose();
		material.dispose();
	});
</script>

<T.Group bind:ref={group}>
	<T is={line} />
</T.Group>
