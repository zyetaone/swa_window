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
	const WING_X_BASE = -7.4;
	const WING_Y_BASE = -3.0;
	const WING_Z_BASE = -12.2;
	// Orientation (radians). rotY≈1.36 is the receding swing (span → depth);
	// rotX is the static resting pitch (look-down onto the top surface) — NOT
	// the bank, which the tick applies separately from motion.bankAngle. rotZ
	// is a small sweep tilt.
	const WING_ROT_X = 0.02;
	const WING_ROT_Y = 1.62;
	const WING_ROT_Z = 0.18;
	// Absolute model-unit scale (both GLBs are normalized to a 17-unit span by
	// scripts/extract-wing.ts, so a direct scalar is exact).
	const WING_SCALE = 0.76;
	// The right wing (wing.glb) is correct when orbitDirection === this value.
	// When the seeded orbit runs the other way, we show the LEFT wing
	// (wing-left.glb) instead — the plane's real mirror wing, with its own
	// readable "Southwest.com" livery — so the winglet always trails the motion
	// without a negative-scale mirror (which would reverse the text).
	const WING_NATURAL_DIR = 1;

	// ONE wing holder. placement carries shared Y/Z; the holder carries X +
	// the direction mirror. The reverse orbit direction is handled by a
	// negative-X scale on the holder (see tick) — NOT a second GLB — so there's
	// only ever one wing in the scene (no stray second wing, no visibility swap
	// to fight Threlte over). The model has zero textures, so a mirror has no
	// livery text to reverse.
	const placement = new Group();
	const holder = new Group();
	placement.add(holder);
	placement.position.set(0, WING_Y_BASE, WING_Z_BASE);
	holder.position.x = WING_X_BASE;

	// Mutable X base — the tuner drives this via __wing.setXBase; the tick
	// re-derives holder.position.x from it every frame.
	let xBase = WING_X_BASE;

	// Winglet tip in HOLDER-LOCAL space for the night nav lights (so the
	// holder's mirror scale flips it with the wing).
	let tip = new Vector3();

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

	// Load + normalize + orient the wing GLB into the holder.
	const loader = new GLTFLoader();
	function loadWing(url: string, rot: [number, number, number]): () => void {
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
				// Winglet tip in holder-local space (worldToLocal undoes the
				// holder transform, leaving m's own transformed outboard-top
				// extreme). Nav lights are children of holder, so this rides the
				// mirror scale automatically.
				holder.updateWorldMatrix(true, false);
				const wb = new Box3().setFromObject(m);
				tip = holder.worldToLocal(new Vector3(wb.max.x, wb.max.y, (wb.min.z + wb.max.z) / 2));
				navLight.position.copy(tip);
				strobeLight.position.copy(tip);
				// Dev-only live tuning hook.
				if (import.meta.env.DEV) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(window as any).__wing = {
						placement, aero: model, model: m,
						setXBase: (v: number) => { xBase = v; },
						get xBase() { return xBase; },
					};
				}
			})
			.catch((err) => console.error(`[Wing] ${url} load failed`, err));
		return () => { cancelled = true; };
	}

	$effect(() => loadWing('/models/wing.glb', [WING_ROT_X, WING_ROT_Y, WING_ROT_Z]));

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

	// Nav lights are children of the holder, fixed at the holder-local winglet
	// tip — so they inherit the holder's direction-mirror scale automatically
	// (no per-frame repositioning).
	holder.add(navLight, strobeLight);

	// Reusable bank quaternions — avoid per-frame allocation. Bank is now
	// three-axis: a screen-plane roll (z) plus a dimensional pitch (x) + yaw
	// (y) so the wing tilts INTO the turn rather than just rolling flat.
	const _bankAxis = new Vector3(0, 0, 1);
	const _bankQuat = new Quaternion();
	const _bankAxisX = new Vector3(1, 0, 0);
	const _bankQuatX = new Quaternion();
	const _bankQuatY = new Quaternion();
	// Reusable per-Pi yaw-compensation quaternion (see tick for the why).
	const _yawAxis = new Vector3(0, 1, 0);
	const _yawQuat = new Quaternion();
	const DEG2RAD = Math.PI / 180;

	let _strobeT = 0;
	const STROBE_PERIOD_S = 1.0;
	const STROBE_PULSE_S = 0.06;

	useTask((dt) => {
		// The camera-mirror wrapper IS placement's parent (the <T.Group> below).
		// Read it directly rather than via bind:ref — the bound $state wasn't
		// populating, so the whole tick was early-returning (no visibility swap,
		// no bank). placement.parent is set as soon as the group mounts.
		const group = placement.parent;
		if (!group) return;

		// Wing follows flight direction via a single mirrored wing. A negative-X
		// scale reflects the right wing's pose [rx,ry,rz] into [rx,-ry,-rz] —
		// exactly the opposite-wing look (winglet trailing the other way) — so
		// the reverse orbit needs no second GLB and no visibility swap. Nav
		// lights are holder children, so they mirror along for free.
		const orbitDir = untrack(() => model.flight.orbitDirection);
		const showRight = orbitDir === WING_NATURAL_DIR;
		holder.position.x = xBase;
		holder.scale.x = showRight ? 1 : -1;

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

		// Bank — three-axis so the wing tilts INTO the turn. Screen-plane roll
		// (z) is the dominant motion; a smaller pitch (x) drops/raises the tip
		// and a yaw (y) sweeps it fore/aft, giving the bank real dimension
		// instead of a flat 2D roll. Coefficients are deliberately modest;
		// tune to taste.
		const bankAngleDeg = untrack(() => model.motion.bankAngle);
		_bankQuat.setFromAxisAngle(_bankAxis, bankAngleDeg * 0.55 * DEG2RAD);
		_bankQuatX.setFromAxisAngle(_bankAxisX, bankAngleDeg * 0.18 * DEG2RAD);
		_bankQuatY.setFromAxisAngle(_yawAxis, bankAngleDeg * 0.12 * DEG2RAD);
		group.quaternion.multiply(_bankQuat).multiply(_bankQuatX).multiply(_bankQuatY);

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

<T.Group>
	<T is={placement} />
</T.Group>
