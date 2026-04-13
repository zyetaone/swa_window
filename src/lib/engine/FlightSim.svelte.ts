/**
 * FlightSimEngine - Flight position, orbit, scenario, and cruise state machine.
 *
 * Extracted from WindowModel Phase 6. Owns all position/heading/pitch state,
 * elliptical orbit with breathing radius, waypoint scenario interpolation,
 * cruise departure/transit state machine, and altitude auto-adjustment.
 *
 * Cross-cutting side-effects (blind, director reset, location change) are
 * handled via callbacks so this engine stays decoupled from WindowModel's
 * UI and atmosphere concerns.
 */

import { clamp, lerp, normalizeHeading } from '$lib/shared/utils';
import { AIRCRAFT } from '$lib/shared/constants';
import type { LocationId, SkyState } from '$lib/shared/types';
import { LOCATIONS, LOCATION_MAP } from '$lib/shared/locations';
import { pickScenario, type FlightScenario } from './flight-scenarios';

// ============================================================================
// TYPES
// ============================================================================

export type FlightMode = 'orbit' | 'cruise_departure' | 'cruise_transit';

export interface FlightCallbacks {
	/** Close/open the window blind during cruise transitions */
	setBlindOpen: (open: boolean) => void;
	/** Reset the director timer after arriving at a new location */
	resetDirector: () => void;
	/** Apply the new location to WindowModel (sets location, utcOffset, etc.) */
	onLocationChanged: (locationId: LocationId) => void;
	/** Reset bank angle after transit (owned by motion engine / WindowModel) */
	resetBankAngle: () => void;
}

/** Context passed into tick() from WindowModel each frame */
export interface FlightTickContext {
	time: number;
	userAdjustingAltitude: boolean;
	nightAltitudeTarget: number;
	skyState: SkyState;
}

// ============================================================================
// ENGINE
// ============================================================================

export class FlightSimEngine {
	// --- Position (reactive - read by CesiumManager, Window.svelte) ---
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
	orbitRadiusMajor: number = $state(AIRCRAFT.ORBIT_MAJOR);
	orbitRadiusMinor: number = $state(AIRCRAFT.ORBIT_MINOR);
	orbitBearing = $state(0);
	orbitAngle = $state(0);

	// --- Cruise (non-reactive timing) ---
	cruiseElapsed = 0;
	private preWarpSpeed = 1.0;

	// --- Scenario (private) ---
	private currentScenario: FlightScenario | null = null;
	private scenarioWaypointIndex = 0;
	private scenarioProgress = 0;

	// --- Derived ---
	isTransitioning = $derived(this.flightMode !== 'orbit');
	cruiseDestinationName = $derived(
		this.cruiseTargetId ? (LOCATION_MAP.get(this.cruiseTargetId)?.name ?? this.cruiseTargetId) : null
	);

	// --- Callbacks ---
	private callbacks: FlightCallbacks;

	constructor(callbacks: FlightCallbacks) {
		this.callbacks = callbacks;
	}

	// ====================================================================
	// PUBLIC API
	// ====================================================================

	/**
	 * Initiate cruise transition to a new location.
	 * Starts departure sequence: warp ramp + blind close.
	 */
	flyTo(locationId: LocationId): void {
		if (this.cruiseTargetId === locationId) return;

		const target = LOCATION_MAP.get(locationId);
		if (!target) return;

		this.cruiseTargetId = locationId;
		this.flightMode = 'cruise_departure';
		this.cruiseElapsed = 0;
		this.warpFactor = 0;
		this.preWarpSpeed = this.flightSpeed;
	}

	/**
	 * Teleport to a location and reset orbit. Used for initial placement
	 * and by tickTransit after blind-closed teleport.
	 */
	setLocation(locationId: LocationId): void {
		const loc = LOCATION_MAP.get(locationId);
		if (!loc) return;
		this.lat = loc.lat;
		this.lon = loc.lon;
		this.orbitCenterLat = loc.lat;
		this.orbitCenterLon = loc.lon;
		this.orbitBearing = this.computeOrbitBearing(loc.lat, loc.lon);
		this.orbitAngle = 0;

		// Pick a new flight scenario for the destination
		this.initScenario(locationId, 'day'); // skyState passed at tick; use fallback here
	}

	/**
	 * Full setLocation with skyState for scenario selection.
	 * Called from WindowModel.setLocation() which knows skyState.
	 */
	setLocationWithSky(locationId: LocationId, skyState: SkyState): void {
		const loc = LOCATION_MAP.get(locationId);
		if (!loc) return;
		this.lat = loc.lat;
		this.lon = loc.lon;
		this.orbitCenterLat = loc.lat;
		this.orbitCenterLon = loc.lon;
		this.orbitBearing = this.computeOrbitBearing(loc.lat, loc.lon);
		this.orbitAngle = 0;

		this.initScenario(locationId, skyState);
	}

	setAltitude(alt: number): void {
		if (!Number.isFinite(alt)) return;
		this.altitude = clamp(alt, AIRCRAFT.MIN_ALTITUDE, AIRCRAFT.MAX_ALTITUDE);
	}

	setHeading(heading: number): void {
		if (!Number.isFinite(heading)) return;
		this.heading = normalizeHeading(heading);
	}

	setPitch(pitch: number): void {
		if (!Number.isFinite(pitch)) return;
		this.pitch = clamp(pitch, -90, 90);
	}

	/** Pick next location weighted by time of day (nature mornings, cities midday/night) */
	pickNextLocation(localTimeOfDay: number, currentLocationId: LocationId): LocationId {
		const hour = localTimeOfDay;
		const preferCity = (hour >= 10 && hour < 16) || hour >= 19 || hour < 5;
		const candidates = LOCATIONS.filter(l => l.id !== currentLocationId);
		const preferred = candidates.filter(l => preferCity ? l.hasBuildings : !l.hasBuildings);
		const pool = preferred.length > 0 ? preferred : candidates;
		return pool[Math.floor(Math.random() * pool.length)].id;
	}

	// ====================================================================
	// TICK (called by WindowModel.tick each frame)
	// ====================================================================

	tick(delta: number, ctx: FlightTickContext): void {
		if (this.flightMode === 'cruise_departure') {
			this.tickDeparture(delta);
			this.tickFlightPath(delta, ctx);
		} else if (this.flightMode === 'cruise_transit') {
			this.tickTransit(delta);
		} else {
			this.tickFlightPath(delta, ctx);
		}
		this.tickAltitude(delta, ctx);
	}

	// ====================================================================
	// PRIVATE - Cruise / Transition
	// ====================================================================

	private tickDeparture(delta: number): void {
		this.cruiseElapsed += delta;

		// Warp ramp: 0->1 over ~2.5s with smoothstep
		const warpDuration = 2.5;
		const t = clamp(this.cruiseElapsed / warpDuration, 0, 1);
		this.warpFactor = t * t * (3 - 2 * t); // smoothstep

		// Physically accelerate: ramp orbit speed from normal to 100x
		const warpSpeed = this.preWarpSpeed + this.warpFactor * 100;
		this.flightSpeed = warpSpeed;

		// After warp peaks (2.0s), close blind and transition
		if (this.cruiseElapsed > 2.0) {
			this.callbacks.setBlindOpen(false);
			this.flightMode = 'cruise_transit';
			this.cruiseElapsed = 0;
		}
	}

	private tickTransit(delta: number): void {
		this.cruiseElapsed += delta;

		// Fade warp back to 0 with ease-out
		const decay = clamp(this.warpFactor - delta * 2.5, 0, 1);
		this.warpFactor = decay * decay;

		// Decelerate back toward normal speed behind the blind
		this.flightSpeed = this.preWarpSpeed + this.warpFactor * 100;

		// While blind is closed, teleport after 2 seconds
		if (this.cruiseElapsed > 2.0 && this.cruiseTargetId) {
			// Notify WindowModel to update location/utcOffset
			this.callbacks.onLocationChanged(this.cruiseTargetId);

			this.cruiseTargetId = null;
			this.flightMode = 'orbit';

			// Open blind to reveal new location
			this.callbacks.setBlindOpen(true);

			// Reset flight parameters
			this.warpFactor = 0;
			this.callbacks.resetBankAngle();
			this.flightSpeed = this.preWarpSpeed;
			this.callbacks.resetDirector();
		}
	}

	// ====================================================================
	// PRIVATE - Flight Path
	// ====================================================================

	/** Dispatch to scenario interpolation or fallback orbit */
	private tickFlightPath(delta: number, ctx: FlightTickContext): void {
		if (this.currentScenario) {
			this.tickScenario(delta, ctx);
		} else {
			this.tickOrbit(delta, ctx);
		}
	}

	private tickOrbit(delta: number, ctx: FlightTickContext): void {
		// Dynamic orbit breathing: radius oscillates slowly for natural variation
		const breathePhase = (ctx.time / AIRCRAFT.ORBIT_BREATHE_PERIOD) * Math.PI * 2;
		const breathe = (Math.sin(breathePhase) + 1) * 0.5;
		const majorRange = AIRCRAFT.ORBIT_MAJOR_MAX - AIRCRAFT.ORBIT_MAJOR_MIN;
		this.orbitRadiusMajor = AIRCRAFT.ORBIT_MAJOR_MIN + breathe * majorRange;
		this.orbitRadiusMinor = this.orbitRadiusMajor * (0.35 + breathe * 0.15);

		const a = this.orbitRadiusMajor;
		const b = this.orbitRadiusMinor;

		// Arc-length parameterization: constant ground speed, variable angular speed
		const tx = a * Math.cos(this.orbitAngle);
		const ty = -b * Math.sin(this.orbitAngle);
		const localSpeed = Math.sqrt(tx * tx + ty * ty);
		const angularSpeed = (AIRCRAFT.DRIFT_RATE * this.flightSpeed) / Math.max(localSpeed, 0.001);
		this.orbitAngle += angularSpeed * delta;
		if (this.orbitAngle > Math.PI * 2) this.orbitAngle -= Math.PI * 2;

		// Elliptical position, rotated by orbit bearing
		const ex = a * Math.sin(this.orbitAngle);
		const ey = b * Math.cos(this.orbitAngle);
		const cb = Math.cos(this.orbitBearing);
		const sb = Math.sin(this.orbitBearing);
		const cosLat = Math.cos(this.orbitCenterLat * Math.PI / 180);

		const newLat = this.orbitCenterLat + (ex * cb - ey * sb);
		const newLon = this.orbitCenterLon + (ex * sb + ey * cb) / Math.max(cosLat, 0.1);
		if (Number.isFinite(newLat)) this.lat = newLat;
		if (Number.isFinite(newLon)) this.lon = newLon;

		// Heading from ellipse tangent
		const rtx = tx * cb - ty * sb;
		const rty = tx * sb + ty * cb;
		const tangentHeading = (Math.atan2(rty, rtx) * 180) / Math.PI;
		const baseHeading = normalizeHeading(tangentHeading);

		// Subtle heading wander
		const wander = Math.sin(ctx.time * 0.05) * 0.25
			+ Math.sin(ctx.time * 0.031) * 0.15
			+ Math.sin(ctx.time * 0.017) * 0.1;
		this.heading = normalizeHeading(baseHeading + wander);
	}

	/**
	 * Interpolate position/heading/altitude along waypoint path.
	 * Uses smoothstep easing for natural acceleration/deceleration.
	 */
	private tickScenario(delta: number, ctx: FlightTickContext): void {
		const scenario = this.currentScenario;
		if (!scenario || scenario.waypoints.length < 2) return;

		const waypoints = scenario.waypoints;
		const idx = this.scenarioWaypointIndex;
		const nextIdx = (idx + 1) % waypoints.length;
		const current = waypoints[idx];
		const next = waypoints[nextIdx];

		// Advance progress
		const duration = next.duration > 0 ? next.duration : 30;
		this.scenarioProgress += (delta * this.flightSpeed) / duration;

		// Smoothstep easing
		const raw = clamp(this.scenarioProgress, 0, 1);
		const t = raw * raw * (3 - 2 * raw);

		// Subtle jitter
		const jitterScale = 0.0003;
		const jitterLat = Math.sin(ctx.time * 0.13) * jitterScale + Math.sin(ctx.time * 0.31) * jitterScale * 0.5;
		const jitterLon = Math.sin(ctx.time * 0.17) * jitterScale + Math.sin(ctx.time * 0.37) * jitterScale * 0.5;

		// Interpolate position
		const newLat = lerp(current.lat, next.lat, t) + jitterLat;
		const newLon = lerp(current.lon, next.lon, t) + jitterLon;
		if (Number.isFinite(newLat)) this.lat = newLat;
		if (Number.isFinite(newLon)) this.lon = newLon;

		// Interpolate altitude (only if user isn't manually adjusting)
		if (!ctx.userAdjustingAltitude) {
			const altJitter = Math.sin(ctx.time * 0.07) * 50;
			this.altitude = lerp(current.altitude, next.altitude, t) + altJitter;
		}

		// Interpolate heading - shortest arc
		let headingDiff = next.heading - current.heading;
		if (headingDiff > 180) headingDiff -= 360;
		if (headingDiff < -180) headingDiff += 360;
		const headingJitter = Math.sin(ctx.time * 0.05) * 0.25 + Math.sin(ctx.time * 0.031) * 0.15;
		this.heading = normalizeHeading(current.heading + headingDiff * t + headingJitter);

		// Move to next waypoint when progress completes
		if (this.scenarioProgress >= 1) {
			this.scenarioProgress = 0;
			this.scenarioWaypointIndex = nextIdx;

			// If we looped back to 0, check if we should pick a new scenario
			if (nextIdx === 0 && scenario.loop) {
				const fresh = pickScenario(this.currentLocationId(), ctx.skyState);
				if (fresh && fresh.id !== scenario.id) {
					this.currentScenario = fresh;
					this.scenarioWaypointIndex = 0;
					this.scenarioProgress = 0;
				}
			}
		}
	}

	// ====================================================================
	// PRIVATE - Altitude
	// ====================================================================

	private tickAltitude(delta: number, ctx: FlightTickContext): void {
		if (ctx.userAdjustingAltitude) return;
		const target = ctx.nightAltitudeTarget;
		const diff = target - this.altitude;
		if (Math.abs(diff) > 500) {
			this.altitude += Math.sign(diff) * Math.min(Math.abs(diff) * 0.01, 50) * delta * 60;
		}
	}

	// ====================================================================
	// PRIVATE - Helpers
	// ====================================================================

	/** Deterministic hash to spread orbit orientations across locations */
	private computeOrbitBearing(lat: number, lon: number): number {
		return (Math.abs(lat * 37 + lon * 59) % 180) * Math.PI / 180;
	}

	/** Initialize a scenario for the given location */
	private initScenario(locationId: LocationId, skyState: SkyState): void {
		const scenario = pickScenario(locationId, skyState);
		this.currentScenario = scenario;
		this.scenarioWaypointIndex = 0;
		this.scenarioProgress = 0;
	}

	/**
	 * Determine current location ID from orbit center coordinates.
	 * Used by scenario loop to pick fresh scenarios.
	 */
	private currentLocationId(): LocationId {
		// Find closest location to orbit center
		let closest: LocationId = 'dubai';
		let minDist = Infinity;
		for (const loc of LOCATIONS) {
			const dLat = loc.lat - this.orbitCenterLat;
			const dLon = loc.lon - this.orbitCenterLon;
			const dist = dLat * dLat + dLon * dLon;
			if (dist < minDist) {
				minDist = dist;
				closest = loc.id;
			}
		}
		return closest;
	}
}
