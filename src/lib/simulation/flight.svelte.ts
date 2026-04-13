/**
 * FlightSimEngine - Flight position, orbit, scenario, and cruise state machine.
 */

import { clamp, lerp, normalizeHeading, shortestAngleDelta } from '$lib/utils';
import { AIRCRAFT } from '$lib/constants';
import type { LocationId, SkyState, SimulationContext, FlightMode, FlightPatch, FlightScenario } from '$lib/types';
import { LOCATION_MAP } from '$lib/locations';
import { pickScenario } from '$lib/simulation/scenarios';

export class FlightSimEngine {
	// --- Position (reactive) ---
	lat = $state(25.2048);
	lon = $state(55.2708);
	altitude = $state(35000);
	heading = $state(45);
	pitch = $state(75);

	// --- Flight mode (reactive) ---
	flightMode = $state<FlightMode>('orbit');
	cruiseTargetId = $state<LocationId | null>(null);
	warpFactor = $state(0);
	flightSpeed = $state(1.0);

	// --- Orbit ---
	orbitCenterLat = $state(25.2048);
	orbitCenterLon = $state(55.2708);
	orbitRadiusMajor = $state<number>(AIRCRAFT.ORBIT_MAJOR);
	orbitRadiusMinor = $state<number>(AIRCRAFT.ORBIT_MINOR);
	orbitBearing = $state(0);
	orbitAngle = $state(0);

	// --- Internal state (#private) ---
	#cruiseElapsed = 0;
	#preWarpSpeed = 1.0;
	#currentScenario: FlightScenario | null = null;
	#scenarioWaypointIndex = 0;
	#scenarioProgress = 0;

	// --- Derived ---
	isTransitioning = $derived(this.flightMode !== 'orbit');
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
		this.orbitBearing = this.#computeOrbitBearing(loc.lat, loc.lon);
		this.orbitAngle = 0;
		this.#initScenario(locationId, skyState);
	}

	setAltitude(alt: number): void {
		if (!Number.isFinite(alt)) return;
		this.altitude = clamp(alt, AIRCRAFT.MIN_ALTITUDE, AIRCRAFT.MAX_ALTITUDE);
	}

	// ====================================================================
	// TICK (ISimulationEngine)
	// ====================================================================

	tick(delta: number, ctx: SimulationContext): FlightPatch {
		const patch: FlightPatch = {};

		if (this.flightMode === 'cruise_departure') {
			this.#tickDeparture(delta, patch);
			this.#tickFlightPath(delta, ctx);
		} else if (this.flightMode === 'cruise_transit') {
			this.#tickTransit(delta, patch);
		} else {
			this.#tickFlightPath(delta, ctx);
		}
		this.#tickAltitude(delta, ctx);

		return patch;
	}

	// ====================================================================
	// PRIVATE
	// ====================================================================

	#tickDeparture(delta: number, patch: FlightPatch): void {
		this.#cruiseElapsed += delta;
		const warpDuration = 2.5;
		const t = clamp(this.#cruiseElapsed / warpDuration, 0, 1);
		this.warpFactor = t * t * (3 - 2 * t);
		this.flightSpeed = this.#preWarpSpeed + this.warpFactor * 100;

		if (this.#cruiseElapsed > 2.0) {
			patch.blindOpen = false;
			this.flightMode = 'cruise_transit';
			this.#cruiseElapsed = 0;
		}
	}

	#tickTransit(delta: number, patch: FlightPatch): void {
		this.#cruiseElapsed += delta;
		const decay = clamp(this.warpFactor - delta * 2.5, 0, 1);
		this.warpFactor = decay * decay;
		this.flightSpeed = this.#preWarpSpeed + this.warpFactor * 100;

		if (this.#cruiseElapsed > 2.0 && this.cruiseTargetId) {
			const arrivedAt = this.cruiseTargetId;
			this.cruiseTargetId = null;
			this.flightMode = 'orbit';
			this.warpFactor = 0;
			this.flightSpeed = this.#preWarpSpeed;
			patch.locationArrived = arrivedAt;
			patch.blindOpen = true;
			patch.resetDirector = true;
		}
	}

	#tickFlightPath(delta: number, ctx: SimulationContext): void {
		if (this.#currentScenario) this.#tickScenario(delta, ctx);
		else this.#tickOrbit(delta, ctx);
	}

	#tickOrbit(delta: number, ctx: SimulationContext): void {
		const breathePhase = (ctx.time / AIRCRAFT.ORBIT_BREATHE_PERIOD) * Math.PI * 2;
		const breathe = (Math.sin(breathePhase) + 1) * 0.5;
		this.orbitRadiusMajor = AIRCRAFT.ORBIT_MAJOR_MIN + breathe * (AIRCRAFT.ORBIT_MAJOR_MAX - AIRCRAFT.ORBIT_MAJOR_MIN);
		this.orbitRadiusMinor = this.orbitRadiusMajor * (0.35 + breathe * 0.15);

		const a = this.orbitRadiusMajor;
		const b = this.orbitRadiusMinor;

		const tx = a * Math.cos(this.orbitAngle);
		const ty = -b * Math.sin(this.orbitAngle);
		const localSpeed = Math.sqrt(tx * tx + ty * ty);
		this.orbitAngle += ((AIRCRAFT.DRIFT_RATE * this.flightSpeed) / Math.max(localSpeed, 0.001)) * delta;
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

		// Subtle pitch breathing — ±1.5° around altitude-derived base
		this.pitch = this.#altitudePitch() + Math.sin(ctx.time * 0.03) * 1.5;
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
		this.pitch = this.#altitudePitch() + Math.sin(ctx.time * 0.04) * 1.0;

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
		const loc = LOCATION_MAP.get(ctx.locationId);
		const targetAlt = ctx.nightFactor > 0.5
			? (loc?.nightAltitude ?? 35000)
			: (loc?.defaultAltitude ?? 35000);
		this.altitude += (targetAlt - this.altitude) * Math.min(delta * 0.1, 1);
	}

	/** Base pitch from altitude: higher = more downward (70-80° range) */
	#altitudePitch(): number {
		const altNorm = clamp((this.altitude - AIRCRAFT.MIN_ALTITUDE) / (AIRCRAFT.MAX_ALTITUDE - AIRCRAFT.MIN_ALTITUDE), 0, 1);
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
