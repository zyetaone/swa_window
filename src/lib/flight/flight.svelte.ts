/**
 * FlightSimEngine - Flight position, orbit, scenario, and cruise state machine.
 *
 * Phase 5 migration: all AIRCRAFT constants replaced with ctx.camera.orbit.*,
 * ctx.camera.altitude.*, and ctx.camera.cruise.* reads.
 */

import { untrack } from 'svelte';
import { clamp, normalizeHeading, shortestAngleDelta } from '$lib/utils';
import type { LocationId, SkyState, SimulationContext, FlightMode, FlightPatch, FlightScenario } from '$lib/types';
import { LOCATION_MAP } from '$content/locations';
import { pickScenario } from '$lib/director/scenarios';
import { createSeededRng, daySeed, hashString } from '$lib/world/prng';

/**
 * Uniform Catmull-Rom interpolation of a scalar through 4 control points,
 * evaluated at local parameter t∈[0,1] between p1 and p2.
 *
 * Why: a per-segment smoothstep (the old `raw*raw*(3-2*raw)`) eases velocity to
 * ZERO at p1 AND p2 — so the camera visibly decelerates to a STOP at every
 * waypoint, then re-accelerates ("moves and stops"). Catmull-Rom is
 * C1-continuous across the join (the tangent leaving one segment matches the
 * tangent entering the next), so a LINEAR time parameter carries the camera
 * THROUGH each waypoint at steady speed. p0/p3 are the neighbouring waypoints
 * that shape the tangents.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
	const t2 = t * t;
	const t3 = t2 * t;
	return 0.5 * (
		2 * p1 +
		(-p0 + p2) * t +
		(2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
		(-p0 + 3 * p1 - 3 * p2 + p3) * t3
	);
}

export class FlightSimEngine {
	// --- Position (plain — pull model for engines; no 60Hz reactive fan-out) ---
	// UI/HUD only needs flightMode, altitude, flightSpeed, warpFactor, cruise*.
	// Cesium/Three read pose imperatively each frame (syncCamera, useTask).
	lat = 25.2048;
	lon = 55.2708;
	heading = 45;
	pitch = 60;
	// Operator-facing: sliders + readout (keep reactive).
	altitude = $state<number>(5_000);

	// --- Smoothed camera pose (plain SSOT for Cesium + Three pull) ---
	camLat = 25.2048;
	camLon = 55.2708;
	camAlt = 5_000;
	camHeading = 45;
	camPitch = 60;
	#camInitialized = false;

	// --- Flight mode (reactive — shell HUD / blind / fleet) ---
	flightMode = $state<FlightMode>('orbit');
	cruiseTargetId = $state<LocationId | null>(null);
	warpFactor = $state(0);
	flightSpeed = $state(4.0);

	// --- Orbit (plain; tests read bearing/angle for 3-Pi determinism) ---
	orbitCenterLat = 25.2048;
	orbitCenterLon = 55.2708;
	orbitRadiusMajor = 0.15;
	orbitRadiusMinor = 0.06;
	orbitBearing = 0;
	orbitAngle = 0;
	// Rotation sense around the orbit ellipse: +1 or -1. Randomised
	// (deterministically) per location so the camera doesn't always sweep
	// the same way — some passes go left-to-right, others right-to-left.
	orbitDirection = $state(1);

	// --- Internal state (#private) ---
	// Night-city flyover override. When set (feet), #tickAltitude drives the
	// camera down to this altitude instead of the location's nightAltitude,
	// and descends a bit faster so the descent reads within a ~45s beat.
	// null = off (normal altitude logic). Deterministic (no random) so all 3
	// Pis descend identically. Set/cleared by AeroWindow.enter/exitFlyover.
	#flyoverAltitudeFt: number | null = null;
	#cruiseElapsed = 0;
	#arrivalHoldElapsed = 0;
	#arrivalHoldTargetSec = 0;
	#preWarpSpeed = 1.0;
	#currentScenario: FlightScenario | null = null;
	#scenarioWaypointIndex = 0;
	#scenarioProgress = 0;
	#scenarioLoopCount = 0;
	static SCENARIO_MAX_LOOPS = 3;
	// Scenario direction — toggled randomly on loop so the flight doesn't
	// always trace the same waypoints in the same order.
	#scenarioForward = true;

	// --- Derived ---
	// Single source of truth for travel direction. Everything downstream that
	// needs "which way are we going" (world drift, wing mirror, wing turn-lean)
	// derives from this one value via screen-conventions.ts — see that file for
	// why the old four-separate-sign-sites design kept the wing fighting the
	// movement. Currently the orbit rotation sense; cruise/scenario modes can
	// override it here later without touching the consumers.
	get travelSign(): number {
		// During scenarios, direction comes from #scenarioForward (toggled on loop).
		// During orbit, direction comes from orbitDirection (randomised per location).
		if (this.#currentScenario) return this.#scenarioForward ? 1 : -1;
		return this.orbitDirection;
	}

	isTransitioning = $derived(this.flightMode !== 'orbit' && this.flightMode !== 'arrival_hold');
	cruiseDestinationName = $derived(
		this.cruiseTargetId ? (LOCATION_MAP.get(this.cruiseTargetId)?.name ?? this.cruiseTargetId) : null
	);

	// ====================================================================
	// PUBLIC API
	// ====================================================================

	flyTo(locationId: LocationId, skyState: SkyState): void {
		if (this.cruiseTargetId === locationId) return;
		const target = LOCATION_MAP.get(locationId);
		if (!target) return;
		this.cruiseTargetId = locationId;
		// Snapshot the pre-warp speed only when NOT already cruising. A mid-cruise
		// flyTo (LocationPicker re-target) would otherwise capture the WARPED speed
		// (preWarp + 100), and #tickTransit would restore that as the permanent
		// orbit speed — the orbit then runs ~25x fast forever. Must read
		// isTransitioning BEFORE flipping flightMode below (it derives from it).
		if (!this.isTransitioning) {
			this.#preWarpSpeed = this.flightSpeed;
		}
		this.flightMode = 'cruise_departure';
		this.#cruiseElapsed = 0;
		this.warpFactor = 0;
		// Real sky state, not a hardcoded 'day' — a night departure should
		// play a night-picked scenario for the ~2s departure window too.
		this.#initScenario(locationId, skyState);
	}

	setLocationWithSky(locationId: LocationId, skyState: SkyState): void {
		const loc = LOCATION_MAP.get(locationId);
		if (!loc) return;
		this.lat = loc.lat;
		this.lon = loc.lon;
		this.orbitCenterLat = loc.lat;
		this.orbitCenterLon = loc.lon;
		// Deterministic orbit seed — daySeed() ^ location hash. All 3 Pis in a
		// panorama share daySeed and the broadcast location, so they compute
		// an IDENTICAL orbit (bearing + start angle + rotation direction) and
		// stay position-locked (only their yaw offset differs). Was raw
		// Math.random(), which diverged each Pi's camera position and broke
		// the panorama. The day component keeps the orbit fresh day-to-day.
		const rng = createSeededRng((daySeed() ^ hashString(locationId)) >>> 0);
		this.orbitBearing = this.#computeOrbitBearing(loc.lat, loc.lon) + (rng() - 0.5) * 0.6;
		this.orbitAngle = rng() * Math.PI * 2;
		// Randomise rotation sense so the camera sweep isn't always the same
		// direction. Deterministic via the seeded rng → identical across Pis.
		this.orbitDirection = rng() < 0.5 ? -1 : 1;
		this.#initScenario(locationId, skyState);
	}

	setAltitude(alt: number, bounds: { min: number; max: number }): void {
		if (!Number.isFinite(alt)) return;
		this.altitude = clamp(alt, bounds.min, bounds.max);
	}

	/** Engage the night-city flyover altitude override (feet). #tickAltitude
	 *  descends here instead of the location's nightAltitude until cleared. */
	setFlyoverAltitude(ft: number): void {
		if (!Number.isFinite(ft)) return;
		this.#flyoverAltitudeFt = ft;
	}

	/** Release the flyover override — altitude returns to normal night logic. */
	clearFlyoverAltitude(): void {
		this.#flyoverAltitudeFt = null;
	}

	// ====================================================================
	// TICK
	// ====================================================================

	tick(delta: number, ctx: SimulationContext): FlightPatch {
		const patch: FlightPatch = {};
		untrack(() => {
			if (this.flightMode === 'cruise_departure') {
				this.#tickDeparture(delta, patch, ctx);
				this.#tickFlightPath(delta, ctx);
			} else if (this.flightMode === 'cruise_transit') {
				this.#tickTransit(delta, patch, ctx);
			} else if (this.flightMode === 'arrival_hold') {
				this.#tickArrivalHold(delta, patch);
			} else {
				this.#tickFlightPath(delta, ctx);
			}
			this.#tickAltitude(delta, ctx);

			this.#tickSmoothing(delta);
		});
		return patch;
	}

	// ====================================================================
	// PRIVATE
	// ====================================================================

	#tickSmoothing(delta: number): void {
		if (!this.#camInitialized) {
			this.camLat = this.lat; this.camLon = this.lon; this.camAlt = this.altitude;
			this.camHeading = this.heading; this.camPitch = this.pitch;
			this.#camInitialized = true;
			return;
		}

		// Heavy camera feel: lerp toward logical state.
		// k = 0.12s time constant (same as previous Cesium lerp for continuity).
		const k = Math.min(1 - Math.exp(-delta / 0.12), 0.3);

		this.camLat += (this.lat - this.camLat) * k;
		this.camLon += (this.lon - this.camLon) * k;
		this.camAlt += (this.altitude - this.camAlt) * k;

		this.camHeading = normalizeHeading(this.camHeading + shortestAngleDelta(this.camHeading, this.heading) * k);
		this.camPitch += (this.pitch - this.camPitch) * k;
	}

	#tickDeparture(delta: number, patch: FlightPatch, ctx: SimulationContext): void {
		this.#cruiseElapsed += delta;
		const cruiseCfg = ctx.camera.cruise;
		const warpDuration = cruiseCfg.departureDurationSec;
		const t = clamp(this.#cruiseElapsed / warpDuration, 0, 1);
		this.warpFactor = t * t * (3 - 2 * t);
		this.flightSpeed = this.#preWarpSpeed + this.warpFactor * 100;

		// Exit on the DEPARTURE knob, which is the one the ramp above is scaled
		// to. This used to read transitDurationSec: identical today (both 2.0s)
		// so the bug is invisible, but raising departureDurationSec alone would
		// cut the smoothstep off mid-ramp — at departure=4s the phase ends with
		// warpFactor ≈ 0.5 and #tickTransit's decay starts from there, so the
		// warp visibly snaps instead of easing. A duration knob must gate its
		// own phase.
		if (this.#cruiseElapsed > warpDuration) {
			patch.blindOpen = false;
			this.flightMode = 'cruise_transit';
			this.#cruiseElapsed = 0;
		}
	}

	#tickTransit(delta: number, patch: FlightPatch, ctx: SimulationContext): void {
		this.#cruiseElapsed += delta;
		const decay = clamp(this.warpFactor - delta * 2.5, 0, 1);
		this.warpFactor = decay * decay;
		this.flightSpeed = this.#preWarpSpeed + this.warpFactor * 100;

		if (this.#cruiseElapsed > ctx.camera.cruise.transitDurationSec && this.cruiseTargetId) {
			const arrivedAt = this.cruiseTargetId;
			this.cruiseTargetId = null;
			this.flightMode = 'arrival_hold';
			this.#arrivalHoldElapsed = 0;
			this.#arrivalHoldTargetSec = ctx.camera.cruise.arrivalHoldMs / 1000;
			this.warpFactor = 0;
			this.flightSpeed = this.#preWarpSpeed;
			patch.locationArrived = arrivedAt;
			patch.blindOpen = true;
			patch.resetDirector = true;
		}
	}

	#tickArrivalHold(delta: number, _patch: FlightPatch): void {
		this.#arrivalHoldElapsed += delta;
		if (this.#arrivalHoldElapsed >= this.#arrivalHoldTargetSec) {
			this.flightMode = 'orbit';
			this.#arrivalHoldElapsed = 0;
		}
	}

	#tickFlightPath(delta: number, ctx: SimulationContext): void {
		if (this.#currentScenario) this.#tickScenario(delta, ctx);
		else this.#tickOrbit(delta, ctx);
	}

	#tickOrbit(delta: number, ctx: SimulationContext): void {
		const orbit = ctx.camera.orbit;
		const breathePhase = (ctx.time / orbit.breathePeriod) * Math.PI * 2;
		const breathe = (Math.sin(breathePhase) + 1) * 0.5;
		this.orbitRadiusMajor = orbit.majorMin + breathe * (orbit.majorMax - orbit.majorMin);
		this.orbitRadiusMinor = this.orbitRadiusMajor * (0.35 + breathe * 0.15);

		const a = this.orbitRadiusMajor;
		const b = this.orbitRadiusMinor;

		const tx = a * Math.cos(this.orbitAngle);
		const ty = -b * Math.sin(this.orbitAngle);
		const localSpeed = Math.sqrt(tx * tx + ty * ty);
		// Advance the orbit angle in the chosen rotation sense (±1). Wrap
		// both ends now that the angle can decrease as well as increase.
		this.orbitAngle += this.orbitDirection * ((orbit.driftRate * this.flightSpeed) / Math.max(localSpeed, 0.001)) * delta;
		if (this.orbitAngle > Math.PI * 2) this.orbitAngle -= Math.PI * 2;
		if (this.orbitAngle < 0) this.orbitAngle += Math.PI * 2;

		const ex = a * Math.sin(this.orbitAngle);
		const ey = b * Math.cos(this.orbitAngle);
		const cb = Math.cos(this.orbitBearing);
		const sb = Math.sin(this.orbitBearing);
		const cosLat = Math.cos(this.orbitCenterLat * Math.PI / 180);

		const newLat = this.orbitCenterLat + (ex * cb - ey * sb);
		const newLon = this.orbitCenterLon + (ex * sb + ey * cb) / Math.max(cosLat, 0.1);
		if (Number.isFinite(newLat)) this.lat = newLat;
		if (Number.isFinite(newLon)) this.lon = newLon;

		// Heading follows the actual direction of travel: negate the tangent
		// when orbiting in reverse so a reversed orbit banks the opposite way
		// (turn rate → bank coupling in motion.svelte stays correctly signed).
		const vtx = tx * this.orbitDirection;
		const vty = ty * this.orbitDirection;
		const baseHeading = normalizeHeading((Math.atan2(vtx * sb + vty * cb, vtx * cb - vty * sb) * 180) / Math.PI);
		const wander = Math.sin(ctx.time * 0.05) * 0.25 + Math.sin(ctx.time * 0.031) * 0.15 + Math.sin(ctx.time * 0.017) * 0.1;
		this.heading = normalizeHeading(baseHeading + wander);
	}

	#tickScenario(delta: number, ctx: SimulationContext): void {
		if (!this.#currentScenario) return;
		const waypoints = this.#currentScenario.waypoints;
		const n = waypoints.length;
		const idx = this.#scenarioWaypointIndex;
		const fwd = this.#scenarioForward;
		// Forward: nextIdx = (idx+1)%n, control points wrap forward.
		// Reverse: nextIdx = (idx-1+n)%n, control points wrap backward.
		const nextIdx = fwd ? (idx + 1) % n : (idx - 1 + n) % n;
		const p0 = fwd ? waypoints[(idx - 1 + n) % n] : waypoints[(idx + 1) % n];
		const p1 = waypoints[idx];
		const p2 = waypoints[nextIdx];
		const p3 = fwd ? waypoints[(nextIdx + 1) % n] : waypoints[(nextIdx - 1 + n) % n];

		const duration = p2.duration > 0 ? p2.duration : 30;
		this.#scenarioProgress += (delta * this.flightSpeed) / duration;

		// LINEAR param (was smoothstep) — Catmull-Rom now supplies the smoothing,
		// so a steady param advances the camera THROUGH each waypoint instead of
		// easing to a halt at it.
		const t = clamp(this.#scenarioProgress, 0, 1);

		const js = 0.0003;
		const jLat = Math.sin(ctx.time * 0.13) * js + Math.sin(ctx.time * 0.31) * js * 0.5;
		const jLon = Math.sin(ctx.time * 0.17) * js + Math.sin(ctx.time * 0.37) * js * 0.5;

		const newLat = catmullRom(p0.lat, p1.lat, p2.lat, p3.lat, t) + jLat;
		const newLon = catmullRom(p0.lon, p1.lon, p2.lon, p3.lon, t) + jLon;
		if (Number.isFinite(newLat)) this.lat = newLat;
		if (Number.isFinite(newLon)) this.lon = newLon;

		// A passenger override OR an active flyover beat suppresses the
		// scenario's authored altitude — #tickAltitude then owns altitude
		// (holds the manual value / drives the flyover descent). Without the
		// flyover guard the scenario re-wrote the waypoint altitude every
		// frame and the descent never happened.
		if (!ctx.userAdjustingAltitude && this.#flyoverAltitudeFt === null) {
			this.altitude =
				catmullRom(p0.altitude, p1.altitude, p2.altitude, p3.altitude, t) +
				Math.sin(ctx.time * 0.07) * 50;
		}

		// Heading: smooth the AUTHORED waypoint headings with the same Catmull-Rom,
		// but UNWRAP them first (shortestAngleDelta chain anchored on p1) so the
		// 359°→0° seam interpolates the short way, not a full spin.
		const u1 = p1.heading;
		const u0 = u1 + shortestAngleDelta(u1, p0.heading);
		const u2 = u1 + shortestAngleDelta(u1, p2.heading);
		const u3 = u2 + shortestAngleDelta(u2, p3.heading);
		this.heading = normalizeHeading(catmullRom(u0, u1, u2, u3, t) + Math.sin(ctx.time * 0.05) * 0.25);
		this.pitch = this.#altitudePitch(ctx) + Math.sin(ctx.time * 0.04) * 1.0;

		if (this.#scenarioProgress >= 1) {
			this.#scenarioProgress = 0;
			this.#scenarioWaypointIndex = nextIdx;
			if (nextIdx === 0) {
				this.#scenarioLoopCount++;
				// loop:false runs exactly once then hands back to the orbit —
				// without this the modulo indexing above would wrap the
				// waypoints and a run-once scenario would fly forever.
				// loop:true expires after SCENARIO_MAX_LOOPS.
				if (!this.#currentScenario.loop || this.#scenarioLoopCount >= FlightSimEngine.SCENARIO_MAX_LOOPS) {
					this.#currentScenario = null;
					this.#scenarioLoopCount = 0;
				} else {
					// Mix the loop counter into the seed. Re-seeding with the
					// plain daySeed ^ location hash redraws the SAME stream on
					// every loop, so the flip and the re-pick below returned
					// identical results each time. The counter is deterministic
					// per day, so all 3 Pis still compute the same sequence.
					const rng = createSeededRng(
						(daySeed() ^ hashString(ctx.locationId) ^ Math.imul(this.#scenarioLoopCount, 0x9E3779B9)) >>> 0
					);
					// Randomly flip direction on each loop — the flight doesn't
					// always trace the same waypoints in the same order.
					this.#scenarioForward = rng() < 0.5;
					const fresh = pickScenario(ctx.locationId, ctx.skyState, rng);
					if (fresh && fresh.id !== this.#currentScenario.id) {
						this.#currentScenario = fresh;
					}
				}
			}
		}
	}

	#tickAltitude(delta: number, ctx: SimulationContext): void {
		if (ctx.userAdjustingAltitude) return;
		const altCfg = ctx.camera.altitude;
		// Flyover beat override — descend to the beat's low altitude, a touch
		// faster than the normal settle so it lands within the beat window.
		// Clamped to the camera bounds. Deterministic → identical on all Pis.
		if (this.#flyoverAltitudeFt !== null) {
			const target = clamp(this.#flyoverAltitudeFt, altCfg.min, altCfg.max);
			this.altitude += (target - this.altitude) * Math.min(delta * 0.12, 1);
			return;
		}
		const loc = LOCATION_MAP.get(ctx.locationId);
		const targetAlt = ctx.nightFactor > 0.5
			? (loc?.nightAltitude ?? altCfg.default)
			: (loc?.defaultAltitude ?? altCfg.default);
		// Lerp toward the location's preferred altitude. Rate softened
		// 0.1 → 0.04 (10s → ~25s time constant) so the initial descent
		// from config default 35kft to a city nightAltitude doesn't
		// perceptibly shrink the FOV and "switch off" city lights at the
		// frame edges. Slower descent reads as "settling cruise" rather
		// than "elevator dropping".
		this.altitude += (targetAlt - this.altitude) * Math.min(delta * 0.04, 1);
	}

	#altitudePitch(ctx: SimulationContext): number {
		const altCfg = ctx.camera.altitude;
		const altNorm = clamp((this.altitude - altCfg.min) / (altCfg.max - altCfg.min), 0, 1);
		return 70 + altNorm * 10;
	}

	#computeOrbitBearing(lat: number, lon: number): number {
		return (Math.abs(lat * 37 + lon * 59) % 180) * Math.PI / 180;
	}

	#initScenario(locationId: LocationId, skyState: SkyState): void {
		const rng = createSeededRng((daySeed() ^ hashString(locationId)) >>> 0);
		this.#currentScenario = pickScenario(locationId, skyState, rng);
		this.#scenarioWaypointIndex = 0;
		this.#scenarioLoopCount = 0;
		this.#scenarioForward = true;
	}
}
