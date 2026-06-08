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
	 * pattern as WingContrail). The wing holder sits at a fixed camera-LOCAL
	 * offset, shifted along camera-X by the per-Pi `fuselageOffsetM` so each
	 * Pi in a panorama sees a different portion of the same wing.
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
	const WING_X_BASE = 0.3;
	const WING_Y_BASE = -3.6;
	const WING_Z_BASE = -8.6;
	// Orientation (radians). rotY≈1.36 is the receding swing (span → depth);
	// rotX is the static resting pitch (look-down onto the top surface) — NOT
	// the bank, which the tick applies separately from motion.bankAngle. rotZ
	// is a small sweep tilt.
	const WING_ROT_X = 0.12;
	const WING_ROT_Y = 1.36;
	const WING_ROT_Z = 0.2;
	// Absolute model-unit scale (baked from the tuner — the GLB is a fixed
	// asset so a direct scalar is exact and resolution-independent).
	const WING_SCALE = 0.91;

	// Placement holder (positioned/offset per frame) → wingHolder (the model).
	const placement = new Group();
	const wingHolder = new Group();
	placement.add(wingHolder);
	placement.position.set(WING_X_BASE, WING_Y_BASE, WING_Z_BASE);

	// Mutable X base. The tick re-derives placement.position.x every frame
	// (WING_X_BASE − fuselageOffset for per-Pi parallax), so a raw write to
	// placement.position.x is clobbered each frame — that's why the tuner's
	// posX appeared dead. The tuner now drives THIS instead via __wing.setXBase.
	let xBase = WING_X_BASE;

	let group = $state.raw<ThreeGroup | undefined>();

	// Load + normalize + orient the real wing GLB.
	const loader = new GLTFLoader();
	$effect(() => {
		let cancelled = false;
		loader
			.loadAsync('/models/wing.glb')
			.then((gltf) => {
				if (cancelled) return;
				const m = gltf.scene as Object3D;
				const box = new Box3().setFromObject(m);
				const center = box.getCenter(new Vector3());
				m.position.sub(center);
				m.scale.setScalar(WING_SCALE);
				// Orient: rotY≈1.36 swings the span into depth (receding wing),
				// rotX a small look-down pitch, rotZ sweep (see constants).
				m.rotation.set(WING_ROT_X, WING_ROT_Y, WING_ROT_Z);
				// Convert each GLB material to a FLAT (unlit) MeshBasicMaterial
				// keeping its albedo colour/map. The scene's ambient is near-
				// zero at high altitude, so the GLB's PBR materials rendered
				// black; flat materials always show the livery (white wing skin,
				// Heart-gradient winglet) regardless of scene light — same
				// reliable-visibility choice as the old placeholder. nightFactor
				// dimming can be layered on later.
				// DoubleSide: the GLB's wing skin is modelled as single-sided
				// shells, so looking DOWN onto the top surface (the passenger's
				// view) showed straight through the back-face-culled top into
				// the underside — the "top material missing / transparent" bug.
				// Rendering both faces fills the top in.
				const toFlat = (src: { color?: Color; map?: unknown }) =>
					new MeshBasicMaterial({
						color: src.color ? src.color.clone() : new Color(0.8, 0.8, 0.82),
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						map: (src.map as any) ?? null,
						side: DoubleSide,
						fog: false,
					});
				m.traverse((o) => {
					const me = o as Mesh;
					if (!me.isMesh) return;
					me.frustumCulled = false;
					const mat = me.material as { color?: Color; map?: unknown } | { color?: Color; map?: unknown }[];
					me.material = Array.isArray(mat) ? mat.map(toFlat) : toFlat(mat);
				});
				wingHolder.add(m);
				// Auto-place the night nav lights at the model's far wingtip,
				// derived from the oriented bounding box (the old TIP_* constants
				// were for the deleted placeholder slab). Attaching them to
				// wingHolder means they inherit placement + fuselageOffset for
				// free — no per-frame position juggling needed.
				const tipBox = new Box3().setFromObject(wingHolder);
				const tip = new Vector3(
					tipBox.min.x,
					tipBox.max.y,
					(tipBox.min.z + tipBox.max.z) / 2,
				);
				navLight.position.copy(tip);
				strobeLight.position.copy(tip);
				wingHolder.add(navLight, strobeLight);
				// Dev-only live tuning hook — adjust placement/scale/orientation
				// from the console without an edit→reload cycle:
				//   __wing.placement.position.set(x, y, z)
				//   __wing.model.rotation.y = Math.PI/2
				//   __wing.model.scale.multiplyScalar(0.6)
				if (import.meta.env.DEV) {
					(window as unknown as { __wing: unknown }).__wing = {
						placement,
						model: m,
						aero: model,
						// posX must go through here — the tick owns placement.position.x.
						setXBase: (v: number) => { xBase = v; },
						get xBase() { return xBase; },
					};
				}
			})
			.catch((err) => console.error('[Wing] wing.glb load failed', err));
		return () => {
			cancelled = true;
		};
	});

	// ─── Night nav lights ───────────────────────────────────────────────
	const lightGeom = new SphereGeometry(0.35, 8, 8);
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

	// Reusable bank quaternion — avoid per-frame allocation.
	const _bankAxis = new Vector3(0, 0, 1);
	const _bankQuat = new Quaternion();

	let _strobeT = 0;
	const STROBE_PERIOD_S = 1.0;
	const STROBE_PULSE_S = 0.06;

	useTask((dt) => {
		if (!group) return;

		// Per-Pi fuselage offset along camera-X. The nav lights are children of
		// wingHolder (under placement), so they inherit this shift for free.
		const fuselageOffset = untrack(() => model.config.camera.parallax.fuselageOffsetM);
		placement.position.x = xBase - fuselageOffset;

		// Mirror the camera world transform onto the group.
		const cam = ctx.camera.current;
		group.position.copy(cam.position);
		group.quaternion.copy(cam.quaternion);

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
