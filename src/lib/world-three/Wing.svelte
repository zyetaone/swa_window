<script lang="ts">
	/**
	 * Wing — the visible aircraft wing in the passenger window, now the REAL
	 * extracted Southwest 737 wing + winglet + engine (static/models/wing.glb,
	 * derived from the Sketchfab model, CC-BY-4.0). Replaces the earlier
	 * procedural slab placeholder.
	 *
	 * ─── LOAD + ORIENT ─────────────────────────────────────────────────
	 * The GLB was extracted in the model inspector's normalized frame where
	 * the wing SPAN runs along +X, Y is up, Z is fuselage fore/aft. On load
	 * we recenter it, scale the longest axis to TARGET_SPAN_M, and apply a
	 * grazing tilt (rotX) so the broad upper surface faces the eye with the
	 * span receding into the distance — the real out-the-window look. rotY
	 * stays ≈0 (a ±90° Y-rotation swings the span into camera-depth and the
	 * wing reads edge-on). Final pose is tunable via the __wing dev hook.
	 *
	 * ─── CAMERA ANCHORING + 3-PI PANORAMA ──────────────────────────────
	 * Mirrors the camera world transform onto a Group each frame (same
	 * pattern as WingContrail), then STRIPS the per-Pi heading offset from
	 * the orientation so the wing lives in the shared base-heading (aircraft
	 * body) frame. Each yawed Pi camera then sees a different angular slice
	 * of the SAME wing — it flows continuously across the 3-Pi seam, matching
	 * how the world (clouds/terrain/stars) tiles. (A lateral fuselageOffsetM
	 * X-slide was the old approach; it just showed three shifted copies, not
	 * one continuous wing, so it's been replaced by the yaw-compensation.)
	 *
	 * ─── BANK / NIGHT LIGHTS ───────────────────────────────────────────
	 * Bank is a post-rotation about camera-Z (screen-plane roll). The
	 * wingtip carries the canonical 737 night lighting: continuous green nav
	 * light + white anti-collision strobe, gated by nightFactor.
	 *
	 * ─── LIGHTING ──────────────────────────────────────────────────────
	 * The GLB keeps its own materials (white wing skin + Heart-gradient
	 * winglet). They're lit by the scene AmbientLight (tinted by
	 * environmentAmbient → dawn warm / day cool / dusk amber / night blue)
	 * + the Sky IBL, so the wing transitions with time of day automatically.
	 * Fog is disabled on the wing materials (the holder is camera-anchored
	 * but baked far from world origin, so distance fog would wrongly darken
	 * it).
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import { untrack } from 'svelte';
	import {
		Group,
		Box3,
		Vector3,
		Quaternion,
		Mesh,
		MeshBasicMaterial,
		SphereGeometry,
		Color,
		DoubleSide,
		type Object3D,
		type Group as ThreeGroup,
	} from 'three';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Placement in camera-local space (NOTE the camera-mirror swaps handedness,
	// so +X renders screen-LEFT). The wing root sits low in the foreground and
	// the span RECEDES into the distance (rotY≈1.36 swings the span into
	// camera-depth) — the real out-the-window look: root near you, winglet far.
	// Values baked from the DevWingTuner; re-tune there and paste the readout.
	const WING_X_BASE = 2.0;
	const WING_Y_BASE = -3.5;
	const WING_Z_BASE = -9.0;
	// Orientation (radians). rotY≈1.36 is the receding swing (span → depth);
	// rotX is the static resting pitch (look-down onto the top surface) — NOT
	// the bank, which the tick applies separately from motion.bankAngle. rotZ
	// is a small sweep tilt.
	const WING_ROT_X = 0.12;
	const WING_ROT_Y = 1.36;
	const WING_ROT_Z = 0.2;
	// Absolute model-unit scale (both GLBs are normalized to a 17-unit span by
	// scripts/extract-wing.ts, so a direct scalar is exact).
	const WING_SCALE = 0.91;
	// The right wing (wing.glb) is correct when orbitDirection === this value.
	// When the seeded orbit runs the other way, we show the LEFT wing
	// (wing-left.glb) instead — the plane's real mirror wing, with its own
	// readable "Southwest.com" livery — so the winglet always trails the motion
	// without a negative-scale mirror (which would reverse the text).
	const WING_NATURAL_DIR = 1;

	// Placement holder (positioned per frame) → two wing holders, one per side.
	const placement = new Group();
	const rightHolder = new Group();
	const leftHolder = new Group();
	placement.add(rightHolder, leftHolder);
	// placement carries the shared Y/Z; each holder carries its own ±X so the
	// left wing sits at the X-mirror of the right (its model also gets the
	// mirrored rotation below) → the left view mirrors the right's composition.
	placement.position.set(0, WING_Y_BASE, WING_Z_BASE);
	rightHolder.position.x = WING_X_BASE;
	leftHolder.position.x = -WING_X_BASE;

	// Mutable X base. The tick re-derives placement.position.x every frame, so a
	// raw write to placement.position.x is clobbered — the tuner drives THIS via
	// __wing.setXBase instead.
	let xBase = WING_X_BASE;

	// Winglet tips (camera-local, per wing) for the night nav lights.
	let tipRight = new Vector3();
	let tipLeft = new Vector3();

	let group = $state.raw<ThreeGroup | undefined>();

	// Convert a GLB material to a FLAT (unlit) DoubleSide MeshBasicMaterial,
	// keeping its albedo colour/map. Flat because the scene ambient is near-zero
	// at altitude (PBR would render black); DoubleSide because the wing skin is
	// single-sided shells (otherwise the top surface culls to transparent).
	const toFlat = (src: { color?: Color; map?: unknown }) =>
		new MeshBasicMaterial({
			color: src.color ? src.color.clone() : new Color(0.8, 0.8, 0.82),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			map: (src.map as any) ?? null,
			side: DoubleSide,
			fog: false,
		});

	// Load + normalize + orient one wing GLB into the given holder. Both wings
	// get the IDENTICAL pose — because the left wing is the mirror geometry,
	// the same transform renders it as the correct mirror image (winglet
	// trailing the other way) with readable livery.
	const loader = new GLTFLoader();
	function loadWing(
		url: string,
		holder: ThreeGroup,
		rot: [number, number, number],
		isLeft: boolean,
		onTip: (t: Vector3) => void,
	): () => void {
		let cancelled = false;
		loader
			.loadAsync(url)
			.then((gltf) => {
				if (cancelled) return;
				const m = gltf.scene as Object3D;
				m.position.sub(new Box3().setFromObject(m).getCenter(new Vector3()));
				m.scale.setScalar(WING_SCALE);
				m.rotation.set(rot[0], rot[1], rot[2]);
				m.traverse((o) => {
					const me = o as Mesh;
					if (!me.isMesh) return;
					me.frustumCulled = false;
					const mat = me.material as { color?: Color; map?: unknown } | { color?: Color; map?: unknown }[];
					me.material = Array.isArray(mat) ? mat.map(toFlat) : toFlat(mat);
				});
				holder.add(m);
				// Winglet tip = the outboard span extreme (max.x for the right
				// wing, min.x for the mirrored left), at the top of the bbox.
				const tb = new Box3().setFromObject(holder);
				onTip(new Vector3(isLeft ? tb.min.x : tb.max.x, tb.max.y, (tb.min.z + tb.max.z) / 2));
				// Dev-only live tuning hook. __wing.model is the right wing (the
				// one the tuner edits); the left mirrors the same baked pose, so
				// re-tune the right + reload and both update.
				if (import.meta.env.DEV) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const w = ((window as any).__wing ??= {
						placement,
						aero: model,
						setXBase: (v: number) => { xBase = v; },
						get xBase() { return xBase; },
					});
					if (holder === rightHolder) w.model = m;
				}
			})
			.catch((err) => console.error(`[Wing] ${url} load failed`, err));
		return () => { cancelled = true; };
	}

	$effect(() => {
		// Left wing gets the X-mirror of the pose (negate Y/Z rotations) so its
		// composition mirrors the right's: winglet up-right instead of up-left.
		const c1 = loadWing('/models/wing.glb', rightHolder, [WING_ROT_X, WING_ROT_Y, WING_ROT_Z], false, (t) => (tipRight = t));
		const c2 = loadWing('/models/wing-left.glb', leftHolder, [WING_ROT_X, -WING_ROT_Y, -WING_ROT_Z], true, (t) => (tipLeft = t));
		return () => { c1(); c2(); };
	});

	// ─── Night nav lights ───────────────────────────────────────────────
	const lightGeom = new SphereGeometry(0.12, 8, 8);
	const navMat = new MeshBasicMaterial({
		color: 0x00ff77,
		transparent: true,
		opacity: 0,
		depthWrite: false,
		fog: false,
	});
	const navLight = new Mesh(lightGeom, navMat);
	navLight.frustumCulled = false;

	const strobeMat = new MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0,
		depthWrite: false,
		fog: false,
	});
	const strobeLight = new Mesh(lightGeom, strobeMat);
	strobeLight.frustumCulled = false;

	// Nav lights live on the placement (not a wing holder) and are repositioned
	// each frame to the visible wing's tip — so they're correct for whichever
	// wing is shown.
	placement.add(navLight, strobeLight);

	// Reusable bank quaternion — avoid per-frame allocation.
	const _bankAxis = new Vector3(0, 0, 1);
	const _bankQuat = new Quaternion();
	// Reusable per-Pi yaw-compensation quaternion (see tick for the why).
	const _yawAxis = new Vector3(0, 1, 0);
	const _yawQuat = new Quaternion();
	const DEG2RAD = Math.PI / 180;

	let _strobeT = 0;
	const STROBE_PERIOD_S = 1.0;
	const STROBE_PULSE_S = 0.06;

	useTask((dt) => {
		if (!group) return;

		// Per-wing X (each the mirror of the other); placement carries shared Y/Z.
		// Yaw-compensation below handles the per-Pi panorama continuity.
		rightHolder.position.x = xBase;
		leftHolder.position.x = -xBase;

		// Wing follows flight direction — show the wing whose winglet trails the
		// current orbit sense. Both are real geometry with readable livery, so no
		// text-reversing mirror is needed — we just swap which one is visible.
		const orbitDir = untrack(() => model.flight.orbitDirection);
		const showRight = orbitDir === WING_NATURAL_DIR;
		rightHolder.visible = showRight;
		leftHolder.visible = !showRight;
		navLight.position.copy(showRight ? tipRight : tipLeft);
		strobeLight.position.copy(showRight ? tipRight : tipLeft);

		// Mirror the camera world transform onto the group.
		const cam = ctx.camera.current;
		group.position.copy(cam.position);
		group.quaternion.copy(cam.quaternion);

		// ─── 3-Pi panorama continuity ──────────────────────────────────────
		// The per-Pi heading offset is baked into the camera orientation
		// (compose.ts → effectiveHeading → Cesium camera → CameraMirror → here).
		// If we keep it, the wing is screen-locked identically on all three Pis
		// — you'd see THREE wings, not one continuous wing spanning the seam,
		// contradicting the world (clouds/terrain/stars) which DOES tile across
		// the seam because it's world-anchored. Stripping the offset puts the
		// wing in the shared base-heading (aircraft body) frame, so each yawed
		// camera sees a different angular slice of the SAME wing — it flows
		// continuously across the three screens, matching the world behind it.
		// (Sign verified empirically against the lab role switcher.)
		const headingOffsetDeg = untrack(
			() => model.config.camera.parallax.headingOffsetDeg,
		);
		if (headingOffsetDeg !== 0) {
			_yawQuat.setFromAxisAngle(_yawAxis, headingOffsetDeg * DEG2RAD);
			group.quaternion.multiply(_yawQuat);
		}

		// Bank — post-rotate around local z (screen-plane roll).
		const bankAngleDeg = untrack(() => model.motion.bankAngle);
		const bankRad = (bankAngleDeg * 0.55 * Math.PI) / 180;
		_bankQuat.setFromAxisAngle(_bankAxis, bankRad);
		group.quaternion.multiply(_bankQuat);

		// Hide during cruise warp (teleport).
		const warpFactor = untrack(() => model.flight.warpFactor);
		const visible = warpFactor < 0.05;
		placement.visible = visible;
		navLight.visible = visible;
		strobeLight.visible = visible;
		if (!visible) return;

		// Night nav lights — gated by nightFactor.
		const nf = untrack(() => model.nightFactor);
		navMat.opacity = nf;
		_strobeT += dt;
		if (_strobeT > STROBE_PERIOD_S) _strobeT -= STROBE_PERIOD_S;
		strobeMat.opacity = nf * (_strobeT < STROBE_PULSE_S ? 1 : 0);
	});

	$effect(() => () => {
		lightGeom.dispose();
		navMat.dispose();
		strobeMat.dispose();
	});
</script>

<T.Group bind:ref={group}>
	<T is={placement} />
</T.Group>
