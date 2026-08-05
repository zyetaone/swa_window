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
	 * Mirrors the camera world transform onto a Group each frame, then
	 * STRIPS the per-Pi heading offset from
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
	 * winglet). They're lit by the scene AmbientLight (tinted by the lighting
	 * SSOT → dawn warm / day cool / dusk amber / night blue)
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
		AdditiveBlending,
		MeshBasicMaterial,
		MeshLambertMaterial,
		DirectionalLight,
		HemisphereLight,
		SphereGeometry,
		Color,
		DoubleSide,
		type Object3D,
	} from 'three';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection, sunElevationSin, DEG2RAD } from '$lib/world/sky';
	import { screenTravelSign, getScreenDriftSign, setScreenDriftSign } from '$lib/camera/screen-conventions';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Placement in camera-local space (NOTE the camera-mirror swaps handedness,
	// so +X renders screen-LEFT). The wing root sits low in the foreground and
	// the span RECEDES into the distance (rotY≈1.36 swings the span into
	// camera-depth) — the real out-the-window look: root near you, winglet far.
	// Values baked from the DevWingTuner; re-tune there and paste the readout.
	const WING_X_BASE = -5.3;
	const WING_Y_BASE = -2.6;
	const WING_Z_BASE = -3.0;
	// Orientation (radians). rotY is the receding swing (span → depth); rotX is
	// the static resting pitch (look-down onto the top surface) — NOT the bank,
	// which the tick applies separately from motion.bankAngle. rotZ is a small
	// sweep tilt. Baked from DevWingTuner.
	const WING_ROT_X = 0.02;
	const WING_ROT_Y = 1.68;
	const WING_ROT_Z = 0.18;
	// Per-axis model scale (X span / Y thickness / Z chord). Independent axes so
	// the wing can be stretched/squashed per direction in the tuner. Equal =
	// uniform scale.
	const WING_SCALE_X = 1.11;
	const WING_SCALE_Y = 1.11;
	// Negative Z mirrors the CHORD (leading↔trailing edge) so the wing faces
	// WITH the direction of travel (user-confirmed). Safe now that recenter runs
	// AFTER scale (below) — the negative component no longer offsets the wing
	// off-frame. DoubleSide materials mean the flipped winding doesn't cull.
	const WING_SCALE_Z = -1.11;
	// Mirror state (which travel direction shows the un-mirrored "good" pose) is
	// no longer a standalone WING_NATURAL_DIR guess — it's derived in the tick
	// from screenTravelSign(), the same term that defines world-drift direction,
	// so the wing can't desync from the movement. See screen-conventions.ts.

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

	// Mutable X base — the dev tuner drives this via __wing.setXBase; the tick
	// re-derives holder.position.x from it every frame. $state so Svelte
	// tracks the dev write as a reactive dep — the tick re-evaluates.
	let xBase = $state(WING_X_BASE);

	// albedo colour/map. Lambert (cheap + Pi-friendly — diffuse only, no specular)
	// responds to the scene AmbientLight + the dawn/moon key light below, so the
	// wing reads as a dimensional 3D surface (lit edge + shadowed edge) whose
	// shading SHIFTS as it banks — instead of the old flat MeshBasicMaterial that
	// looked like a static decal day and night. DoubleSide because the wing skin
	// is single-sided shells (the top surface would otherwise cull to transparent).
	// The earlier flat approach existed because PBR went black at altitude with
	// near-zero ambient; the dedicated key light + ambient floor fix that, and the
	// night dimming now falls out of the (low) night light levels for free.
	const toLit = (src: { color?: Color; map?: unknown }) =>
		new MeshLambertMaterial({
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
		// Track the loaded model + the MeshLambertMaterials toLit() mints so the
		// cleanup can dispose them. Without this, each HMR cycle (or any unmount)
		// orphaned the GLB's ~60+ materials + geometries on the GPU.
		let loaded: Object3D | null = null;
		const litMats: MeshLambertMaterial[] = [];
		loader
			.loadAsync(url)
			.then((gltf) => {
				if (cancelled) return;
				const m = gltf.scene as Object3D;
				m.scale.set(WING_SCALE_X, WING_SCALE_Y, WING_SCALE_Z);
				m.rotation.set(rot[0], rot[1], rot[2]);
				// Recenter AFTER scale+rotation so the COMPOSED bbox centers on the
				// holder origin. Recentering first (the old order) bakes the offset
				// at identity scale — a negative scale component then NEGATES the
				// model's internal centre offset instead of compensating it, which
				// translated the whole wing ~2× that offset sideways and parked it
				// off-frame (the WING_SCALE_Z flip made the wing "vanish").
				m.position.sub(new Box3().setFromObject(m).getCenter(new Vector3()));
				m.traverse((o) => {
					const me = o as Mesh;
					if (!me.isMesh) return;
					me.frustumCulled = false;
					const mat = me.material as { color?: Color; map?: unknown } | { color?: Color; map?: unknown }[];
					const lit = Array.isArray(mat) ? mat.map(toLit) : toLit(mat);
					me.material = lit;
					if (Array.isArray(lit)) litMats.push(...lit); else litMats.push(lit);
				});
				// Weld the nav lights to the winglet-tip VERTEX by parenting them
				// to the model `m`. The tip is derived from the ACTUAL geometry at
				// load — not a baked constant, which went stale every time the
				// recenter order or the placement tune changed. Scan every mesh
				// vertex in the COMPOSED frame (post scale+rotation+recenter; m is
				// still unparented so each mesh's matrixWorld is exactly that
				// composition) and take the max-Y vertex: the winglet sweeps up at
				// the span end and is the highest point of the wing in its final
				// pose (verified against the GLB — the top candidates all cluster
				// on the winglet; nothing else competes). The winner maps back to
				// m's LOCAL frame, so the lights ride every model transform (incl.
				// the holder mirror flip) and can never drift off the winglet
				// again. Runs once at load over ~64 meshes — pure geometry, fully
				// deterministic.
				m.updateWorldMatrix(true, true);
				const _v = new Vector3();
				const tipComposed = new Vector3(0, -Infinity, 0);
				m.traverse((o) => {
					const me = o as Mesh;
					if (!me.isMesh) return;
					const pos = me.geometry.getAttribute('position');
					for (let i = 0; i < pos.count; i++) {
						_v.fromBufferAttribute(pos, i).applyMatrix4(me.matrixWorld);
						if (_v.y > tipComposed.y) tipComposed.copy(_v);
					}
				});
				const navPos = tipComposed.clone().applyMatrix4(m.matrix.clone().invert());
				if (import.meta.env.DEV)
					console.debug(
						'[Wing] winglet tip — model-local',
						navPos.toArray().map((n) => n.toFixed(2)),
						'composed',
						tipComposed.toArray().map((n) => n.toFixed(2)),
					);
				holder.add(m);
				loaded = m;
				m.add(navLight, strobeLight, navHalo);
				navLight.position.copy(navPos);
				strobeLight.position.copy(navPos);
				navHalo.position.copy(navPos);
				// Dev-only live tuning hook.
				if (import.meta.env.DEV) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(window as any).__wing = {
						placement, aero: model, model: m,
						setXBase: (v: number) => { xBase = v; },
						get xBase() { return xBase; },
						// Calibration: flip until the wing sweeps WITH the world, then
						// bake the result into DEFAULT_SCREEN_DRIFT_SIGN.
						flipDriftSign: () => { setScreenDriftSign(-getScreenDriftSign()); return getScreenDriftSign(); },
						get driftSign() { return getScreenDriftSign(); },
					};
				}
			})
			.catch((err) => console.error(`[Wing] ${url} load failed`, err));
		return () => {
			cancelled = true;
			// Dispose the GLB model's geometries + the toLit materials, and detach
			// the nav lights (they're module-scoped + disposed in the cleanup effect
			// below, so just unparent them here). Prevents a GPU leak on HMR/unmount.
			if (loaded) {
				loaded.remove(navLight, strobeLight, navHalo);
				loaded.traverse((o) => {
					const me = o as Mesh;
					if (me.isMesh && me.geometry && me !== navLight && me !== strobeLight && me !== navHalo) {
						me.geometry.dispose();
					}
				});
				holder.remove(loaded);
				loaded = null;
			}
			for (const mt of litMats) mt.dispose();
			litMats.length = 0;
		};
	}

	$effect(() => loadWing('/models/wing.glb', [WING_ROT_X, WING_ROT_Y, WING_ROT_Z]));

	// ─── Night nav lights ───────────────────────────────────────────────
	// Enlarged vs the body so the bloom pass blows them into a glowing point —
	// the wing goes dark at night (above) so these are the only bright thing on
	// it, the iconic 737 starboard signal. Strobe sphere is bigger again for a
	// punchier anti-collision flash.
	const navGeom = new SphereGeometry(0.12, 12, 12);
	const strobeGeom = new SphereGeometry(0.18, 12, 12);
	const navMat = new MeshBasicMaterial({
		color: 0x00ee44, // truer aviation green (was 0x00ff77, slightly yellow)
		transparent: true,
		opacity: 0,
		depthWrite: false,
		// depthTest off → the wingtip light always draws over the dark wing
		// (never occluded by the winglet body) and the bloom pass blows it
		// into a glowing emerald point — the star of the night wing.
		depthTest: false,
		fog: false,
	});
	const navLight = new Mesh(navGeom, navMat);
	navLight.frustumCulled = false;
	navLight.renderOrder = 3;

	// Soft additive green halo behind the core — light scattering in humid air;
	// the bloom pass merges it with the core into one coherent glow. Cheap (one
	// 10×10 sphere, additive, depthTest off).
	const navHaloMat = new MeshBasicMaterial({
		color: 0x00ee44,
		transparent: true,
		opacity: 0,
		depthWrite: false,
		depthTest: false,
		blending: AdditiveBlending,
		fog: false,
	});
	const navHalo = new Mesh(new SphereGeometry(0.34, 10, 10), navHaloMat);
	navHalo.frustumCulled = false;
	navHalo.renderOrder = 2;

	const strobeMat = new MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0,
		depthWrite: false,
		depthTest: false,
		fog: false,
	});
	const strobeLight = new Mesh(strobeGeom, strobeMat);
	strobeLight.frustumCulled = false;
	strobeLight.renderOrder = 3;

	// Nav lights are parented to the model `m` at load (see loadWing) so they
	// ride the winglet through every model transform — no per-frame reposition.

	// ─── Dawn / moon key light ──────────────────────────────────────────
	// A single directional light added to the SCENE (NOT the banking wing group,
	// so it stays world-fixed and the wing's shading shifts as it banks). The
	// wing is the only lit-material object in the Three overlay (everything else
	// is sprites / lines / custom shaders), so this light touches nothing but the
	// wing — no layer scoping needed. Direction tracks the sun azimuth but is
	// elevation-floored (tick) so it always rakes the top surface, never a
	// sub-horizon backlight that would black the wing out. Colour + intensity
	// lerp warm-day → cool-moonlight by nightFactor; the scene AmbientLight is
	// the floor that keeps the shadowed side from going pure black.
	const keyLight = new DirectionalLight(0xffffff, 1.0);
	// Soft hemisphere fill so the directional key SHAPES the wing without
	// carving harsh near-black shadow facets at the root / leading edge (which
	// read as "strange" hard shadows). Cool sky tint from above, dim warm bounce
	// from below — a gentle gradient that lifts the shadowed side. Only the wing
	// (sole lit object in the overlay) sees it. Intensity set in the tick.
	const fillLight = new HemisphereLight(0xbcd2ff, 0x2a2620, 0.0);
	$effect(() => {
		const scene = ctx.scene;
		scene.add(keyLight, keyLight.target, fillLight);
		return () => scene.remove(keyLight, keyLight.target, fillLight);
	});

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

	let _strobeT = 0;
	let _swayT = 0;
	// Anti-collision strobe: a DOUBLE flash (two quick pulses STROBE_GAP_S apart)
	// every period — the real 737 beacon cadence, punchier than a single blink.
	const STROBE_PERIOD_S = 1.1;
	const STROBE_PULSE_S = 0.05;
	const STROBE_GAP_S = 0.16;
	// Scratch sun-direction holder for the key light (avoids per-frame alloc).
	const _keyDir = new Vector3();

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
		// Travel direction → screen parity. The wing mirror AND the turn-lean
		// (below) both derive from this ONE term (screen-conventions.ts), so the
		// wing always sweeps WITH the world drift and banks INTO the turn — by
		// construction, not by four separate signs happening to agree.
		const travelSign = untrack(() => model.flight.travelSign);
		const wingSign = untrack(() => model.config.world.wingDriftSign) ?? 1;
		const screenSign = screenTravelSign(travelSign) * wingSign;
		// Seat / window position slides the wing fore-aft along the fuselage axis
		// (holder X). A forward seat (negative offset) shows more trailing edge;
		// an aft seat (positive) more leading edge. Reads the per-role offset the
		// model already computes (parallax.fuselageOffsetM) — 0 for solo, ±6 m for
		// the left/right panorama roles.
		const seatOffset = untrack(() => model.config.camera.parallax.fuselageOffsetM);
		const mirrorX = screenSign >= 0 ? 1 : -1;
		holder.position.x = (xBase + seatOffset) * mirrorX;
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
		// Perpetual gentle sway so the wing is never frozen in the sky. Even in
		// steady orbit (motion.bankAngle ≈ 0) the air keeps the wing in slow
		// motion; combined with the key light, the shifting shade reads as
		// "flying," not a static decal. Two detuned sines → non-repeating ±~2.5°
		// roll at a lazy ~0.08–0.16 Hz.
		_swayT += dt;
		const sway = 1.7 * Math.sin(_swayT * 0.52) + 0.8 * Math.sin(_swayT * 0.97 + 1.3);
		// Steady lean into the circular orbit turn (a real plane holds a bank
		// through a sustained turn). motion.bankAngle only reacts to heading-CHANGE
		// rate, which is ~0 in the slow orbit, so without this the wing wouldn't
		// bank even though the orbit IS a continuous turn. Gated to orbit mode so
		// it doesn't fight the scripted cruise-transition bank. Sign = orbitDir so
		// it leans into the turn direction.
		const flightMode = untrack(() => model.flight.flightMode);
		const ORBIT_BANK_DEG = 5; // gentle, steady lean into the orbit turn (13° read as "weird")
		const turnBank = flightMode === 'orbit' ? screenSign * ORBIT_BANK_DEG : 0;
		const bankAngleDeg = untrack(() => model.motion.bankAngle) + turnBank + sway;
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
		navHaloMat.opacity = nf * 0.35;
		_strobeT += dt;
		if (_strobeT > STROBE_PERIOD_S) _strobeT -= STROBE_PERIOD_S;
		// Double-flash: two sharp pulses (at 0 and STROBE_GAP_S) → the bloom
		// pass turns each into a hard anti-collision burst.
		const flash =
			_strobeT < STROBE_PULSE_S ||
			(_strobeT >= STROBE_GAP_S && _strobeT < STROBE_GAP_S + STROBE_PULSE_S);
		strobeMat.opacity = nf * (flash ? 1 : 0);

		// Dawn / moon key light — direction tracks the sun azimuth with REAL
		// local solar elevation (sunElevationSin) so dawn/dusk light rakes the
		// wing low and noon light falls steep. Floored to +0.15 (never a
		// sub-horizon backlight) and lerped toward the old fixed +0.45 as night
		// falls — the night key is stand-in moonlight, not the sun, so it keeps
		// its calibrated raking angle. Colour + intensity lerp warm-day →
		// cool-dim-moonlight by nightFactor, so the wing dims and cools at night
		// for free (no per-material colour hack) while the AmbientLight floor
		// keeps the shadowed side from crushing to black.
		const timeOfDay = untrack(() => model.timeOfDay);
		const sd = computeSunDirection(untrack(() => model.flight.camLon), timeOfDay);
		const elevSin = Math.max(sunElevationSin(untrack(() => model.flight.camLat), timeOfDay), 0.15);
		const keyElev = elevSin * (1 - nf) + 0.45 * nf;
		_keyDir.set(sd[0], keyElev, sd[2]).normalize().multiplyScalar(1e6);
		keyLight.position.copy(_keyDir); // target stays at origin → rays rake downward
		// Eased key + hemisphere fill → gentle ~2.5:1 lit:shadow ratio instead of
		// the old ~6:1 that made the root facets read as harsh black shadows.
		keyLight.intensity = 0.3 + (1 - nf) * 0.85; // night 0.3 → day 1.15
		keyLight.color.setRGB(1.0 - nf * 0.45, 0.88 - nf * 0.25, 0.72 + nf * 0.28);
		fillLight.intensity = 0.45 - nf * 0.28; // day 0.45 soft fill → night 0.17
	});

	$effect(() => () => {
		navGeom.dispose();
		strobeGeom.dispose();
		navMat.dispose();
		strobeMat.dispose();
		navHaloMat.dispose();
		navHalo.geometry.dispose();
	});
</script>

<T.Group>
	<T is={placement} />
</T.Group>
