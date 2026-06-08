/**
 * FlightSimEngine - Flight position, orbit, scenario, and cruise state machine.
 *
 * Phase 5 migration: all AIRCRAFT constants replaced with ctx.camera.orbit.*,
 * ctx.camera.altitude.*, and ctx.camera.cruise.* reads.
 */

import { untrack } from 'svelte';
import { clamp, lerp, normalizeHeading, shortestAngleDelta } from '$lib/utils';
import type { LocationId, SkyState, SimulationContext, FlightMode, FlightPatch, FlightScenario } from '$lib/types';
import { LOCATION_MAP } from '$content/locations';
import { pickScenario } from '$lib/director/scenarios';

export class FlightSimEngine {
	// --- Position (raw simulation state) ---
	lat = $state(25.2048);
	lon = $state(55.2708);
	altitude = $state<number>(35_000);
	heading = $state(45);
	pitch = $state(75);

	// --- Smoothed Camera (SSOT for rendering) ---
	// These values lerp toward the raw state above to provide "heavy camera"
	// feel and absorb teleports/jitters. SSOT for Cesium + DOM.
	camLat = $state(25.2048);
	camLon = $state(55.2708);
	camAlt = $state(35_000);
	camHeading = $state(45);
	camPitch = $state(75);
	#camInitialized = false;

	// --- Flight mode (reactive) ---
	flightMode = $state<FlightMode>('orbit');
	cruiseTargetId = $state<LocationId | null>(null);
	warpFactor = $state(0);
	flightSpeed = $state(1.4);

	// --- Orbit ---
	orbitCenterLat = $state(25.2048);
	orbitCenterLon = $state(55.2708);
	orbitRadiusMajor = $state<number>(0.15);
	orbitRadiusMinor = $state<number>(0.06);
	orbitBearing = $state(0);
	orbitAngle = $state(0);

	// --- Internal state (#private) ---
	#cruiseElapsed = 0;
	#arrivalHoldElapsed = 0;
	#arrivalHoldTargetSec = 8;
	#preWarpSpeed = 1.0;
	#currentScenario: FlightScenario | null = null;
	#scenarioWaypointIndex = 0;
	#scenarioProgress = 0;

	// --- Derived ---
	isTransitioning = $derived(this.flightMode !== 'orbit' && this.flightMode !== 'arrival_hold');
	cruiseDestinationName = $derived(
		this.cruiseTargetId ? (LOCATION_MAP.get(this.cruiseTargetId)?.name ?? this.cruiseTargetId) : null
	);

	// ====================================================================
	// PUBLIC API
	// ====================================================================

	flyTo(locationId: LocationId): void {
		if (this.cruiseTargetId === locationId) return;
		const target = LOCATION_MAP.get(locationId);
		if (!target) return;
		this.cruiseTargetId = locationId;
		this.flightMode = 'cruise_departure';
		this.#cruiseElapsed = 0;
		this.warpFactor = 0;
		this.#preWarpSpeed = this.flightSpeed;
		this.#initScenario(locationId, 'day');
	}

	setLocationWithSky(locationId: LocationId, skyState: SkyState): void {
		const loc = LOCATION_MAP.get(locationId);
		if (!loc) return;
		this.lat = loc.lat;
		this.lon = loc.lon;
		this.orbitCenterLat = loc.lat;
		this.orbitCenterLon = loc.lon;
		this.orbitBearing = this.#computeOrbitBearing(loc.lat, loc.lon) + (Math.random() - 0.5) * 0.6;
		this.orbitAngle = Math.random() * Math.PI * 2;
		this.#initScenario(locationId, skyState);
	}

	setAltitude(alt: number, bounds: { min: number; max: number }): void {
		if (!Number.isFinite(alt)) return;
		this.altitude = clamp(alt, bounds.min, bounds.max);
	}

	// ====================================================================
	// TICK (ISimulationEngine)
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

		if (this.#cruiseElapsed > cruiseCfg.transitDurationSec) {
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
			this.#arrivalHoldTargetSec = (ctx.camera.cruise.arrivalHoldMs ?? 8000) / 1000;
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
		this.orbitAngle += ((orbit.driftRate * this.flightSpeed) / Math.max(localSpeed, 0.001)) * delta;
		if (this.orbitAngle > Math.PI * 2) this.orbitAngle -= Math.PI * 2;

		const ex = a * Math.sin(this.orbitAngle);
		const ey = b * Math.cos(this.orbitAngle);
		const cb = Math.cos(this.orbitBearing);
		const sb = Math.sin(this.orbitBearing);
		const cosLat = Math.cos(this.orbitCenterLat * Math.PI / 180);

		const newLat = this.orbitCenterLat + (ex * cb - ey * sb);
		const newLon = this.orbitCenterLon + (ex * sb + ey * cb) / Math.max(cosLat, 0.1);
		if (Number.isFinite(newLat)) this.lat = newLat;
		if (Number.isFinite(newLon)) this.lon = newLon;

		const baseHeading = normalizeHeading((Math.atan2(tx * sb + ty * cb, tx * cb - ty * sb) * 180) / Math.PI);
		const wander = Math.sin(ctx.time * 0.05) * 0.25 + Math.sin(ctx.time * 0.031) * 0.15 + Math.sin(ctx.time * 0.017) * 0.1;
		this.heading = normalizeHeading(baseHeading + wander);

		this.pitch = this.#altitudePitch(ctx) + Math.sin(ctx.time * 0.03) * 1.5;
	}

	#tickScenario(delta: number, ctx: SimulationContext): void {
		if (!this.#currentScenario) return;
		const waypoints = this.#currentScenario.waypoints;
		const idx = this.#scenarioWaypointIndex;
		const nextIdx = (idx + 1) % waypoints.length;
		const current = waypoints[idx];
		const next = waypoints[nextIdx];

		const duration = next.duration > 0 ? next.duration : 30;
		this.#scenarioProgress += (delta * this.flightSpeed) / duration;

		const raw = clamp(this.#scenarioProgress, 0, 1);
		const t = raw * raw * (3 - 2 * raw);

		const js = 0.0003;
		const jLat = Math.sin(ctx.time * 0.13) * js + Math.sin(ctx.time * 0.31) * js * 0.5;
		const jLon = Math.sin(ctx.time * 0.17) * js + Math.sin(ctx.time * 0.37) * js * 0.5;

		const newLat = lerp(current.lat, next.lat, t) + jLat;
		const newLon = lerp(current.lon, next.lon, t) + jLon;
		if (Number.isFinite(newLat)) this.lat = newLat;
		if (Number.isFinite(newLon)) this.lon = newLon;

		if (!ctx.userAdjustingAltitude) {
			this.altitude = lerp(current.altitude, next.altitude, t) + Math.sin(ctx.time * 0.07) * 50;
		}

		const hDiff = shortestAngleDelta(current.heading, next.heading);
		this.heading = normalizeHeading(current.heading + hDiff * t + Math.sin(ctx.time * 0.05) * 0.25);
		this.pitch = this.#altitudePitch(ctx) + Math.sin(ctx.time * 0.04) * 1.0;

		if (this.#scenarioProgress >= 1) {
			this.#scenarioProgress = 0;
			this.#scenarioWaypointIndex = nextIdx;
			if (nextIdx === 0 && this.#currentScenario.loop) {
				const fresh = pickScenario(ctx.locationId, ctx.skyState);
				if (fresh && fresh.id !== this.#currentScenario.id) {
					this.#currentScenario = fresh;
					this.#scenarioWaypointIndex = 0;
					this.#scenarioProgress = 0;
				}
			}
		}
	}

	#tickAltitude(delta: number, ctx: SimulationContext): void {
		if (ctx.userAdjustingAltitude) return;
		const altCfg = ctx.camera.altitude;
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
		this.#currentScenario = pickScenario(locationId, skyState);
		this.#scenarioWaypointIndex = 0;
		this.#scenarioProgress = 0;
	}
}
