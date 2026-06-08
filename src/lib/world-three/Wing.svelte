<script lang="ts">
	/**
	 * Wing — the visible aircraft wing rendered as a Three.js mesh in the
	 * passenger window. The single highest-impact "you are on a plane" cue,
	 * sibling of WingContrail (which trails behind the wing this component
	 * draws explicitly).
	 *
	 * ─── CAMERA ANCHORING + 3-PI PANORAMA ──────────────────────────────
	 * Mirrors the camera world transform onto a Group each frame (same
	 * pattern as WingContrail.svelte). The wing mesh lives in camera-LOCAL
	 * coordinates with a per-Pi fuselage offset applied along the camera-X
	 * axis (fuselage fore-aft direction).
	 *
	 * Coordinate convention (passenger looking out the RIGHT-side window):
	 *   -z → camera forward = OUT-THE-WINDOW = wing span direction (root→tip)
	 *   -x → aircraft-front (toward nose)
	 *   +x → aircraft-back (toward tail)
	 *   +y → up (cabin ceiling)
	 *
	 * For 3-Pi panorama (config.camera.parallax.fuselageOffsetM):
	 *   left   (-6 m): passenger seated FORWARD of wing root → wing root
	 *                  appears shifted toward camera-RIGHT (tail direction).
	 *                  Effect: passenger sees the wing receding behind
	 *                  them on the right edge of the view.
	 *   center  (0 m): passenger ON the wing → root directly below, full
	 *                  wing visible extending forward into view.
	 *   right  (+6 m): passenger seated AFT of wing root → wing root
	 *                  appears shifted toward camera-LEFT (nose direction).
	 *                  Effect: passenger sees the wing extending ahead and
	 *                  to the left.
	 *
	 * Sign inverts because passenger sitting forward shifts the wing
	 * VISUALLY backward (it's a frame-of-reference negation).
	 *
	 * ─── BANK ──────────────────────────────────────────────────────────
	 * Plane banking is applied as a post-rotation around the camera-Z axis
	 * (screen-plane rotation, same as the prior CSS .wing-silhouette's
	 * `rotate()` transform). The wing tilts with bank angle × 0.55, the
	 * same coefficient the CSS wing used. Pivot is the camera position
	 * (not wing root) — at small bank angles (~6°) the visual difference
	 * is minor and the cost saving is real.
	 *
	 * ─── NIGHT NAV LIGHTS ──────────────────────────────────────────────
	 * Right wingtip carries the canonical 737 lighting:
	 *   - Continuous GREEN nav light (FAA regulation: green on right wing)
	 *   - White ANTI-COLLISION STROBE — 50ms pulse every ~1 s
	 * Both gated by nightFactor so they materialize during the dusk→night
	 * transition and remain visible until dawn. This is the single highest-
	 * impact night-mode cue passengers actually look for.
	 *
	 * ─── MATERIAL (PLACEHOLDER PHASE) ──────────────────────────────────
	 * MeshBasicMaterial in matte aluminum grey. Basic intentionally ignores
	 * lighting → no directional top/bright + bottom/dark gradient (the
	 * "shadow on the wing" the user explicitly didn't want for the
	 * placeholder). Time-of-day color modulation can be added by lerping
	 * the base color in useTask once the real GLB lands.
	 *
	 * ─── GEOMETRY (PLACEHOLDER) ────────────────────────────────────────
	 * Custom 8-vertex tapered BufferGeometry:
	 *   Root chord 8 m, thickness 1.2 m, at z = +8.5 m (close to fuselage)
	 *   Tip  chord 1.5 m, thickness 0.3 m, at z = -8.5 m (far from fuselage)
	 *   Span 17 m
	 * Computed vertex normals → smooth shading across all faces. Swap with
	 * GLTFLoader on the real Sketchfab-extracted SW 737 wing GLB.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import { untrack } from 'svelte';
	import {
		BufferGeometry,
		BufferAttribute,
		Mesh,
		MeshBasicMaterial,
		SphereGeometry,
		Color,
		Quaternion,
		Vector3,
		type Group as ThreeGroup,
	} from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Wing root sits at camera-X = +2 — slightly to camera-right (= aircraft-
	// tail direction). Models a passenger sitting just FORWARD of the wing
	// root, which is the natural over-wing-row composition (real window-
	// seat eye-line is ~half a row forward of wing root). Y = -3 below
	// sightline so upper surface is visible. Z_BASE = -10 places wing
	// center 10 m forward, geometry extending into the view.
	const WING_X_BASE = 2;
	const WING_Y_BASE = -3;
	const WING_Z_BASE = -10;

	// Wingtip position (for nav lights) — same X centerline as wing root.
	// Tip is at geometry-local z = -6.5; mesh sits at WING_Z_BASE = -10
	// → world z = -16.5. Tip light hovers just above the upper surface.
	const TIP_X = 2;
	const TIP_Y = -2.95;
	const TIP_Z = -16.5;

	// Custom tapered wing geometry — 8 vertices, 12 triangles.
	//
	// SHRUNK substantially: the prior 7m × 0.45m root was visually dominating
	// the lower view at this distance. Real wings ARE huge — but most of the
	// wing is hidden by the fuselage when viewed from a window seat. The
	// VISIBLE portion (the outer half projecting past the fuselage frame) is
	// what we model. Final placeholder: 3m visible-root chord × 0.25m thick,
	// tapering to 0.5m × 0.06m at the tip, span 13m.
	//
	// WINDING NOTE: triangle indices below are wound so each face's outward
	// normal (after computeVertexNormals) points AWAY from the wing's
	// interior. Reversed from the earlier attempt — which gave inverted
	// normals → Lambert sampled the sky IBL cubemap from the WRONG side
	// of each face, so the top read dark and the bottom read bright. The
	// "inverse shadow" the user noticed was literally the lighting model
	// running through a Möbius strip.
	function createWingGeometry(): BufferGeometry {
		const geom = new BufferGeometry();
		const verts = new Float32Array([
			// Root (z = +6.5) — chord 3 m, thickness 0.25 m
			-1.5, -0.125,  6.5,  // 0: root, bottom-front (leading-edge bottom)
			-1.5,  0.125,  6.5,  // 1: root, top-front    (leading-edge top)
			 1.5,  0.125,  6.5,  // 2: root, top-back     (trailing-edge top)
			 1.5, -0.125,  6.5,  // 3: root, bottom-back  (trailing-edge bottom)
			// Tip (z = -6.5) — chord 0.5 m, thickness 0.06 m
			-0.25, -0.03, -6.5,  // 4: tip, bottom-front
			-0.25,  0.03, -6.5,  // 5: tip, top-front
			 0.25,  0.03, -6.5,  // 6: tip, top-back
			 0.25, -0.03, -6.5,  // 7: tip, bottom-back
		]);
		// Outward-normal winding for each face (CCW when viewed from outside):
		const idx = [
			// Bottom face (y-): normal points -Y (down, away from wing interior)
			0, 7, 3,  0, 4, 7,
			// Top face (y+): normal points +Y (up)
			1, 6, 5,  1, 2, 6,
			// Leading edge (x-): normal points -X (toward aircraft-nose)
			0, 5, 4,  0, 1, 5,
			// Trailing edge (x+): normal points +X (toward aircraft-tail)
			3, 6, 2,  3, 7, 6,
			// Root cap (z+): normal points +Z (toward camera, into fuselage)
			0, 2, 1,  0, 3, 2,
			// Tip cap (z-): normal points -Z (away from camera, into space)
			4, 6, 7,  4, 5, 6,
		];
		geom.setAttribute('position', new BufferAttribute(verts, 3));
		geom.setIndex(idx);
		geom.computeVertexNormals();
		return geom;
	}

	const geometry = createWingGeometry();
	const material = new MeshBasicMaterial({
		// MeshBasic ignores lighting entirely — uniform flat color across
		// every face. The wing reads as a clean silhouette against the
		// scene with no directional top/bottom shading. Time-of-day color
		// can be added later by lerping this base via model.nightFactor
		// if a flat night-dim is wanted; left simple for the placeholder.
		color: new Color(0.78, 0.78, 0.82),
		fog: false,
	});
	const wingMesh = new Mesh(geometry, material);
	wingMesh.position.set(WING_X_BASE, WING_Y_BASE, WING_Z_BASE);
	wingMesh.frustumCulled = false;

	// ─── Night nav lights ───────────────────────────────────────────────
	// Shared small sphere geometry for both lights — disposed once.
	const lightGeom = new SphereGeometry(0.35, 8, 8);

	// Green continuous nav light (FAA regulation: green on right wing).
	const navMat = new MeshBasicMaterial({
		color: 0x00ff77, // saturated emerald — reads as a hot point through bloom
		transparent: true,
		opacity: 0,
		depthWrite: false,
		fog: false,
	});
	const navLight = new Mesh(lightGeom, navMat);
	navLight.position.set(TIP_X, TIP_Y, TIP_Z);
	navLight.frustumCulled = false;

	// White anti-collision strobe — pulses ~50 ms every 1 s.
	const strobeMat = new MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0,
		depthWrite: false,
		fog: false,
	});
	const strobeLight = new Mesh(lightGeom, strobeMat);
	// Co-located with nav light at wingtip — strobe blinks white over green.
	strobeLight.position.set(TIP_X, TIP_Y, TIP_Z);
	strobeLight.frustumCulled = false;

	let group = $state.raw<ThreeGroup | undefined>();

	// Reusable bank quaternion — avoid per-frame allocation in the tick path.
	const _bankAxis = new Vector3(0, 0, 1);
	const _bankQuat = new Quaternion();

	// Strobe phase clock — wall-clock advance, per-Pi independent. Per-frame
	// random not needed (strobe is deterministic blink, not stochastic).
	let _strobeT = 0;
	const STROBE_PERIOD_S = 1.0;
	const STROBE_PULSE_S = 0.06; // 60 ms pulse

	useTask((dt) => {
		if (!group) return;

		// Per-Pi fuselage offset along camera-X (fore-aft along fuselage).
		// Sign INVERTS because passenger sitting forward (-6) shifts the
		// wing VISUALLY backward (toward camera-right / aircraft-tail).
		const fuselageOffset = untrack(() => model.config.camera.parallax.fuselageOffsetM);
		wingMesh.position.x = WING_X_BASE - fuselageOffset;
		navLight.position.x = TIP_X - fuselageOffset;
		strobeLight.position.x = TIP_X - fuselageOffset;

		// Mirror camera world transform onto the group so the wing renders
		// in camera-local space without per-vertex math.
		const cam = ctx.camera.current;
		group.position.copy(cam.position);
		group.quaternion.copy(cam.quaternion);

		// Bank — post-rotate around local z (= world camera-forward axis,
		// which is the screen-plane axis = same axis as the CSS rotate()
		// the prior .wing-silhouette used). 0.55 coefficient preserves
		// the visual amplitude the kiosk's been tuned to.
		const bankAngleDeg = untrack(() => model.motion.bankAngle);
		const bankRad = bankAngleDeg * 0.55 * Math.PI / 180;
		_bankQuat.setFromAxisAngle(_bankAxis, bankRad);
		group.quaternion.multiply(_bankQuat);

		// Visibility: hide during cruise warp (teleport). Same gate as
		// WingContrail. Threshold 0.05 matches motion engine's smoothing.
		const warpFactor = untrack(() => model.flight.warpFactor);
		const visible = warpFactor < 0.05;
		wingMesh.visible = visible;
		navLight.visible = visible;
		strobeLight.visible = visible;
		if (!visible) return;

		// Night nav lights — gate by nightFactor so they materialize during
		// the dusk→night transition. environmentAmbient already drives the
		// wing surface color through dawn/dusk; lights add the "alive at
		// night" signal that nothing else in the scene provides.
		const nf = untrack(() => model.nightFactor);
		// Green nav light: continuous at night. Lerp on the 0..1 range so
		// it fades in smoothly during dusk rather than snapping.
		navMat.opacity = nf;

		// White strobe: 60 ms pulse every 1.0 s. Independent per-Pi clock
		// (per-frame timing not part of the determinism contract — each
		// Pi blinking out of sync is invisible at the panorama seam since
		// the pulse is instantaneous).
		_strobeT += dt;
		if (_strobeT > STROBE_PERIOD_S) _strobeT -= STROBE_PERIOD_S;
		const strobeOn = _strobeT < STROBE_PULSE_S;
		strobeMat.opacity = nf * (strobeOn ? 1.0 : 0);
	});

	$effect(() => () => {
		geometry.dispose();
		material.dispose();
		lightGeom.dispose();
		navMat.dispose();
		strobeMat.dispose();
	});
</script>

<T.Group bind:ref={group}>
	<T is={wingMesh} />
	<T is={navLight} />
	<T is={strobeLight} />
</T.Group>
