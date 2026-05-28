/**
 * world-three/state — composables for derived scene values.
 *
 * Real-Earth scale (WGS84). Coordinates in metres, sphere at the actual
 * equatorial radius. This unlocks:
 *   - Real OSM building extrusion at correct geo positions
 *   - Real-world altitude semantics (cruise = 10 668 m for 35 kft)
 *   - (Archived) Takram Bruneton path — see docs/reference/takram-atmosphere-recipe.md
 *   - Future real heightfield terrain
 *
 * Three.js handles big numbers fine; the renderer uses logarithmic depth
 * (set on <Canvas>) so the 1 m → 10⁹ m near/far span works without
 * z-fighting.
 *
 * Conventions (matches three-globe / Three.js community standard):
 *   - World +Y = north pole
 *   - World +X = lat 0 / lon 0       (Greenwich on the equator)
 *   - World +Z = lat 0 / lon -90      (Galápagos/Americas side)
 *   - World -Z = lat 0 / lon +90      (India/East Asia side)
 *   - Sun direction is a unit vector in world space, drives directional
 *     light position scaled by SUN_DISTANCE_M.
 *
 * Why this asymmetric +Z = lon=-90 convention: Three.js's SphereGeometry
 * parameterises with `x = -R cos(phi) sin(theta), z = +R sin(phi) sin(theta)`,
 * which wraps a Plate Carrée equirect texture such that +Z displays
 * lon=-90. Negating Z in geoToCartesian below aligns world positions
 * with the texture wrapping — no texture transform or mesh rotation
 * required. Same convention three-globe and other open-source globes use.
 */

import type { AeroWindow } from '$lib/model/aero-window.svelte';
import { T as TIME } from '$lib/utils';

export const EARTH_RADIUS_M = 6378137;
export const FEET_PER_METER = 3.28084;
// Directional lights in Three.js are parallel — only the position
// VECTOR direction matters, not the magnitude. Keep these within the
// camera's far plane (1e9) so stars actually render in the scene.
export const SUN_DISTANCE_M = 1e8;         // 100 000 km — well past sky scale
export const STARS_RADIUS_M = 5e8;         // 500 000 km — inside far plane
export const SKY_SCALE_M  = 4.5e8;          // Three.js Sky.js — atmospheric dome
export const CLOUD_DECK_M = 8000;           // clouds at ~8 km altitude

/** Earth's axial tilt (radians) — gives the sun an arc across the year. */
const SUN_TILT = 0.4;

type Rgb = [number, number, number];
type Vec3 = [number, number, number];

const lerp3 = (a: Rgb, b: Rgb, t: number): Rgb =>
	[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Convert geographic (lat°, lon°, altitude metres) → world Cartesian.
 *
 * Convention matches three-globe and the broader Three.js community —
 * the Z component is NEGATED to align with the way Three.js's
 * `SphereGeometry` wraps Plate Carrée textures:
 *
 *   Three.js sphere equator (varying phi 0→2π):  -X → +Z → +X → -Z (CCW from +Y)
 *   Texture (Plate Carrée):                       lon=-180 → -90 → 0 → +90
 *
 * Without the Z negation, lon=+90 would land at +Z but the texture
 * shows lon=-90 there — a mirror across the X axis. With Z negated,
 * lon=+90 lands at -Z where the texture shows lon=+90. No texture
 * transform required.
 */
export function geoToCartesian(latDeg: number, lonDeg: number, altM: number): Vec3 {
	const r = EARTH_RADIUS_M + altM;
	const lat = (latDeg * Math.PI) / 180;
	const lon = (lonDeg * Math.PI) / 180;
	const cosLat = Math.cos(lat);
	return [r * cosLat * Math.cos(lon), r * Math.sin(lat), -r * cosLat * Math.sin(lon)];
}

export class SkyState {
	// $derived.by callbacks are LAZY — they only evaluate when read. By
	// the time anything reads these getters, the constructor has finished
	// and `model` is set. TypeScript's strict init analysis doesn't model
	// laziness so we use `!` to assert definite assignment.
	private model!: AeroWindow;

	constructor(model: AeroWindow) {
		this.model = model;
	}

	/**
	 * World-space unit vector pointing from earth-centre toward the sun.
	 *
	 * Lon-aware: at the camera's local solar noon (timeOfDay=12 in
	 * camera-local hours, accounting for camLon), the sun is overhead
	 * the camera's longitude. Formula:
	 *
	 *   sunLon = camLon + 180 − timeOfDay·15   (degrees)
	 *
	 *   t=0  → sunLon = L+180  (sun on opposite side, midnight)
	 *   t=6  → sunLon = L+90   (sun to the east, dawn)
	 *   t=12 → sunLon = L      (sun overhead, noon)
	 *   t=18 → sunLon = L-90   (sun to the west, dusk)
	 *
	 * Declination is fixed at SUN_TILT (~22.9°, close to summer solstice).
	 * Real-world declination varies ±23.5° through the year; the kiosk
	 * doesn't need that fidelity, and a fixed value gives passenger
	 * windows a consistent "midsummer" feel.
	 */
	sunDirection: Vec3 = $derived.by(() => {
		const sunLonRad = ((this.model.flight.camLon + 180 - this.model.timeOfDay * 15) * Math.PI) / 180;
		const cosTilt = Math.cos(SUN_TILT);
		return [
			cosTilt * Math.cos(sunLonRad),
			Math.sin(SUN_TILT),
			-cosTilt * Math.sin(sunLonRad),
		];
	});

	/**
	 * Camera position in world space — placed above the flight's lat/lon at
	 * the current altitude. camLat/camLon/camAlt are SMOOTHED values from
	 * the flight engine (no per-frame stepping).
	 */
	cameraPosition: Vec3 = $derived.by(() => {
		const f = this.model.flight;
		return geoToCartesian(f.camLat, f.camLon, f.camAlt / FEET_PER_METER);
	});

	/** Camera distance from earth centre — useful for near/far derivation. */
	cameraDistance: number = $derived(
		EARTH_RADIUS_M + this.model.flight.camAlt / FEET_PER_METER,
	);

	/**
	 * Camera lookAt target — PASSENGER WINDOW orientation.
	 *
	 * 2026-05-24 reframe: this is an airplane window, not a satellite.
	 * The camera sits above (camLat, camLon, camAlt) and looks FORWARD
	 * along the flight's heading, pitched a few degrees below horizon
	 * the way a real passenger window is angled. Above 50 km we lerp
	 * back to "earth centre" for the orbital aesthetic — but the kiosk
	 * runs at 1-65 kft, which is all passenger-window territory.
	 *
	 * Math (mirrors Cesium setView in compose.ts:582):
	 *   - up        = radial outward at camera position
	 *   - east      = cross(worldY, up)
	 *   - north     = cross(up, east)
	 *   - heading   = camHeading degrees (0 = north, +90 = east)
	 *   - pitchDeg  = camPitch − 90  (Cesium convention: 90 = down)
	 *   - forwardH  = north·cos(h) + east·sin(h)
	 *   - forward   = forwardH·cos(p) + up·sin(p)
	 *   - target    = position + forward × 200 km
	 */
	lookAtTarget: Vec3 = $derived.by(() => {
		const f = this.model.flight;
		const altM = f.camAlt / FEET_PER_METER;
		const [cx, cy, cz] = geoToCartesian(f.camLat, f.camLon, altM);

		// Above ~50 km → orbital "look at earth centre". Below → passenger.
		if (altM > 50_000) return [0, 0, 0];

		const lat0 = (f.camLat * Math.PI) / 180;
		const lon0 = (f.camLon * Math.PI) / 180;
		const ux =  Math.cos(lat0) * Math.cos(lon0);
		const uy =  Math.sin(lat0);
		const uz = -Math.cos(lat0) * Math.sin(lon0);
		// east = cross(worldY, up) — east.y = 0.
		const exRaw =  uz;
		const ezRaw = -ux;
		const eMag = Math.hypot(exRaw, 0, ezRaw) || 1;
		const ex = exRaw / eMag, ez = ezRaw / eMag;
		// north = cross(up, east)
		const nx = uy * ez - uz * 0;
		const ny = uz * ex - ux * ez;
		const nz = ux * 0 - uy * ex;

		// Heading: 0 north, +90 east. Pitch below horizon: camPitch-90.
		// Pass through `effectiveHeading` so 3-Pi panorama parallax offsets
		// (camera.parallax.headingOffsetDeg) apply — left/center/right Pis
		// in a panorama install yaw apart and tile into one continuous view.
		const effectiveHeading = this.model.config.camera.effectiveHeading(f.camHeading);
		const h = (effectiveHeading * Math.PI) / 180;
		const p = ((f.camPitch - 90) * Math.PI) / 180;
		const ch = Math.cos(h), sh = Math.sin(h);
		const cp = Math.cos(p), sp = Math.sin(p);

		// forwardH = north·cos(h) + east·sin(h) — unit horizontal forward.
		const fHx = nx * ch + ex * sh;
		const fHy = ny * ch + 0  * sh;
		const fHz = nz * ch + ez * sh;
		// forward = forwardH·cos(p) + up·sin(p) — pitched.
		const fx = fHx * cp + ux * sp;
		const fy = fHy * cp + uy * sp;
		const fz = fHz * cp + uz * sp;

		// 200 km forward — past the geometric horizon, reads as "to infinity".
		const D = 200_000;
		return [cx + fx * D, cy + fy * D, cz + fz * D];
	});

	/**
	 * Camera up vector — radial outward, rolled around the forward axis
	 * by the motion engine's bank angle so turbulence visibly banks the
	 * view. Consumer must set this on camera.up BEFORE calling lookAt().
	 */
	cameraUp: Vec3 = $derived.by(() => {
		const f = this.model.flight;
		const lat0 = (f.camLat * Math.PI) / 180;
		const lon0 = (f.camLon * Math.PI) / 180;
		const ux =  Math.cos(lat0) * Math.cos(lon0);
		const uy =  Math.sin(lat0);
		const uz = -Math.cos(lat0) * Math.sin(lon0);

		const bank = (this.model.motion.bankAngle * Math.PI) / 180;
		if (Math.abs(bank) < 1e-6) return [ux, uy, uz];

		// Roll up around the local "east" axis by bank. east.y = 0 so
		// cross(east, up) = (-ez·uy, ez·ux - ex·uz, ex·uy).
		const exRaw =  uz;
		const ezRaw = -ux;
		const eMag = Math.hypot(exRaw, 0, ezRaw) || 1;
		const ex = exRaw / eMag, ez = ezRaw / eMag;
		const cb = Math.cos(bank), sb = Math.sin(bank);
		const crx = -ez * uy;
		const cry =  ez * ux - ex * uz;
		const crz =  ex * uy;
		// Rodrigues' simplified (east ⟂ up so the east·up term vanishes):
		let up: Vec3 = [ux * cb + crx * sb, uy * cb + cry * sb, uz * cb + crz * sb];

		// 3-Pi support: rotate the banked up around radial by this device's
		// headingOffset so the tilt reference is correct for its virtual yaw.
		const ho = (this.model.config.camera.parallax.headingOffsetDeg * Math.PI) / 180;
		if (Math.abs(ho) > 1e-6) {
			const co = Math.cos(ho), so = Math.sin(ho);
			const ux_ = up[0], uy_ = up[1], uz_ = up[2];
			up = [
				ux_ * co + (uy * uz_ - uz * uy_) * so,
				uy_ * co + (uz * ux_ - ux * uz_) * so,
				uz_ * co + (ux * uy_ - uy * ux_) * so,
			] as Vec3;
		}
		return up;
	});

	/** Scene background colour — lerps day blue → dusk plum → night. */
	bgColor: Rgb = $derived.by(() => {
		const t = this.model.timeOfDay;
		const day:   Rgb = [0.32, 0.55, 0.95];
		const dusk:  Rgb = [0.18, 0.10, 0.20];
		const night: Rgb = [0.005, 0.015, 0.035];
		if (t >= TIME.DAY_START && t <= TIME.DAY_END) return day;
		if (t < TIME.DAWN_START || t > TIME.DEEP_NIGHT) return night;
		if (t < TIME.DAY_START) {
			const u = (t - TIME.DAWN_START) / (TIME.DAY_START - TIME.DAWN_START);
			return lerp3(night, day, u);
		}
		const u = (t - TIME.DAY_END) / (TIME.DEEP_NIGHT - TIME.DAY_END);
		return u < 0.5 ? lerp3(day, dusk, u * 2) : lerp3(dusk, night, (u - 0.5) * 2);
	});
}
