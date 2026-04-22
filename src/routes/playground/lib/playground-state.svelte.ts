import { type LocationId, type WeatherType } from '$lib/types';
import { LOCATIONS } from '$lib/locations';
import type { PaletteName } from '../palettes';
import { resolveBinding, type DeviceRole, isGroupLeader, headingOffsetForRole } from './corridor.svelte';

// Resolve binding ONCE at module load — same lifecycle as the rest of `pg`.
// Safe because resolveBinding() returns the SSR-safe default when window is
// absent.
const initialBinding = resolveBinding();

export const pg = $state({
	activeLocation: 'dubai' as LocationId,
	timeOfDay: 12,
	weather: 'clear' as WeatherType,
	maplibreSource: 'eox-s2',
	mlTerrain: true,
	mlBuildings: true,
	mlAtmosphere: true,
	showCityLights: true,
	showLandmarks: true,
	density: 0.75,
	cloudSpeed: 1.0,
	cloudScale: 1.0,
	cloudSpread: 1.0,

	altitude: 30000,
	altitudeTarget: 30000,
	altitudeCooldown: 0,
	heading: 90,
	headingTarget: 90,
	headingCooldown: 0,
	planeSpeed: 1.0,
	turbulenceLevel: 'light' as 'light' | 'moderate' | 'severe',
	autoOrbit: false,
	autoTime: false,
	autoFly: true,
	kioskMode: true,
	orbitAngle: Math.random() * Math.PI * 2,
	orbitAngularSpeed: 0.07,
	orbitDirection: Math.random() > 0.5 ? 1 : -1,
	orbitMajor: 0.08 + Math.random() * 0.04,
	orbitMinor: 0.04 + Math.random() * 0.03,
	orbitTilt: Math.random() * Math.PI,
	nextLocationChange: 0,
	pitchBias: 0,
	blindOpen: true,
	paletteName: 'auto' as PaletteName,
	freeCam: false,
	lodMaxZoomLevels: 6,
	lodTileCountRatio: 2.0,
	// ─── SWA corridor (Feature 1 + 2) ────────────────────────────────────────
	/** Pane role within its corridor. Default 'solo' = single-window mode. */
	role: initialBinding.role as DeviceRole,
	/** Corridor group — panes sharing this id share altitude/weather/location. */
	groupId: initialBinding.groupId,
	/** Auto-cycle location every rotateIntervalMin ± 0.2 min. */
	autoRotate: true,
	/** Interval between location rotations, in minutes (2–3). */
	rotateIntervalMin: 2.5,

	/** Unified Viewport Extensions */
	abstractionEnabled: true,
	// Use 'sim' for takram volumetric or 'artsy' for css3d
	cloudMode: 'sim' as 'sim' | 'artsy', 
});

/** Global night factor derived from time of day (0=day, 1=night) */
export const pgNightFactor = $derived.by(() => {
	const t = pg.timeOfDay;
	if (t >= 18.5 || t <= 5.5) return 1.0;
	if (t >= 7 && t <= 17) return 0.0;
	if (t < 7) return (7 - t) / 1.5;
	return (t - 17) / 1.5;
});

import * as THREE from 'three';
/** Reactive sun direction vector based on time of day */
export function getSunDirection() {
	const t = pg.timeOfDay;
	const angle = (t - 12) * (Math.PI / 12);
	const radius = 1e6;
	return new THREE.Vector3(
		Math.sin(angle) * radius,
		Math.cos(angle) * radius,
		Math.sin(angle) * 0.4 * radius
	).normalize();
}




if (typeof window !== 'undefined') {
	pg.nextLocationChange = performance.now() + rotateIntervalMs();
	pg.heading = Math.floor(Math.random() * 360);
	pg.headingTarget = pg.heading;
}

export const ALT_HOLD_SEC = 6;
const ALT_LERP_RATE = 0.4;
export const HDG_HOLD_SEC = 4;
const HDG_LERP_RATE = 0.6;
const CLOUD_DECK_ALT = 28_000;

// ─── Weighted location pool ─────────────────────────────────────────────────
// Hero destinations (SWA hubs + flagship routes) get 3x weight vs tertiary
// picks. Tertiary still appears so the wall doesn't feel repetitive.
const HERO_IDS = new Set<LocationId>([
	'dallas', 'chicago_midway', 'phoenix', 'las_vegas', 'denver',
]);
const HERO_WEIGHT = 3;
const OTHER_WEIGHT = 1;

function pickWeightedLocation(exclude?: LocationId): LocationId {
	const pool = LOCATIONS.filter((l) => l.id !== exclude);
	const total = pool.reduce(
		(sum, l) => sum + (HERO_IDS.has(l.id) ? HERO_WEIGHT : OTHER_WEIGHT),
		0,
	);
	let r = Math.random() * total;
	for (const l of pool) {
		r -= HERO_IDS.has(l.id) ? HERO_WEIGHT : OTHER_WEIGHT;
		if (r <= 0) return l.id;
	}
	return pool[0].id;
}

/**
 * Randomised rotation interval in ms. Adds ±12s jitter (uniform in [-0.2, +0.2]
 * minute) so two panes that boot at the same second don't drift in lockstep.
 */
function rotateIntervalMs(): number {
	const mins = Math.max(2, Math.min(3, pg.rotateIntervalMin));
	const jitter = (Math.random() - 0.5) * 0.4; // ±0.2 min = ±12s
	return (mins + jitter) * 60_000;
}

/**
 * Tick. `isLeader` gates local location rotation — follower panes (left/right)
 * wait for `director_decision` from the leader over the fleet WS.
 */
export function pgTick(
	dt: number,
	now: number,
	isBoosting = false,
	isLeader = isGroupLeader(pg.role),
) {
	if (pg.autoTime) {
		pg.timeOfDay = (pg.timeOfDay + dt * 0.5) % 24;
	}

	if (pg.autoFly || isBoosting) {
		// Only the group leader rotates locally. Followers receive a
		// director_decision and schedule it to apply at a shared wall-clock
		// instant.
		if (pg.kioskMode && pg.autoRotate && isLeader && now > pg.nextLocationChange) {
			pgCycleLocation(now);
		}

		const altSlow = Math.sin(now * 0.00004) * 6000;
		const altFast = Math.sin(now * 0.00012) * 2000;
		pg.altitudeTarget = Math.max(18_000, Math.min(42_000,
			CLOUD_DECK_ALT + altSlow + altFast
		));

		if (pg.altitudeCooldown > 0) {
			pg.altitudeCooldown -= dt;
		} else {
			pg.altitude += (pg.altitudeTarget - pg.altitude) * (1 - Math.exp(-ALT_LERP_RATE * dt));
		}

		pg.orbitAngle += dt * pg.orbitAngularSpeed * pg.planeSpeed * pg.orbitDirection;
		pg.headingTarget = ((pg.orbitAngle * 180 / Math.PI) + 90) % 360;

		if (pg.headingCooldown > 0) {
			pg.headingCooldown -= dt;
		} else {
			let diff = pg.headingTarget - pg.heading;
			if (diff > 180) diff -= 360;
			if (diff < -180) diff += 360;
			pg.heading = (pg.heading + diff * (1 - Math.exp(-HDG_LERP_RATE * dt)) + 360) % 360;
		}
	} else if (pg.autoOrbit) {
		pg.headingTarget = (pg.heading + dt * 5 * pg.planeSpeed) % 360;
		if (pg.headingCooldown > 0) {
			pg.headingCooldown -= dt;
		} else {
			pg.heading = pg.headingTarget;
		}
	}
}

/**
 * Rotate to a new location. If `now` is provided, also reschedules the next
 * rotation timer. The weighted picker favours SWA hubs so the wall feels like
 * a brand story, not a random world tour.
 */
export function pgCycleLocation(now?: number) {
	pg.activeLocation = pickWeightedLocation(pg.activeLocation);

	pg.altitudeTarget = 22_000 + Math.floor(Math.random() * 18_000);
	pg.altitudeCooldown = 0;
	pg.pitchBias = (Math.random() - 0.5) * 12;
	pg.orbitMajor = 0.06 + Math.random() * 0.06;
	pg.orbitMinor = 0.03 + Math.random() * 0.04;
	pg.orbitTilt = Math.random() * Math.PI;
	const turbs: ('light' | 'moderate' | 'severe')[] = ['light', 'light', 'light', 'moderate', 'moderate', 'severe'];
	pg.turbulenceLevel = turbs[Math.floor(Math.random() * turbs.length)];

	if (now) {
		pg.nextLocationChange = now + rotateIntervalMs();
	}
}

/**
 * Apply a remote director_decision — used by follower panes to sync to the
 * leader's rotation. Takes the location (plus optional weather) and schedules
 * all the same local scene shuffle without re-broadcasting.
 */
export function pgApplyRemoteLocation(locationId: LocationId, weather?: WeatherType) {
	pg.activeLocation = locationId;
	if (weather) pg.weather = weather;
	// Reset scene params like a local cycle, so followers feel the same beat.
	pg.altitudeTarget = 22_000 + Math.floor(Math.random() * 18_000);
	pg.altitudeCooldown = 0;
	pg.pitchBias = (Math.random() - 0.5) * 12;
	pg.orbitMajor = 0.06 + Math.random() * 0.06;
	pg.orbitMinor = 0.03 + Math.random() * 0.04;
	pg.orbitTilt = Math.random() * Math.PI;
}

/** Re-read the saved binding (used after admin panel writes a new binding). */
export function pgReloadBinding() {
	const b = resolveBinding();
	pg.role = b.role;
	pg.groupId = b.groupId;
}

/** Public — read the per-role heading offset (deg) for this pane. */
export function pgHeadingOffsetDeg(): number {
	return headingOffsetForRole(pg.role);
}

export function pgReset() {
	pg.heading = 90;
	pg.headingTarget = 90;
	pg.headingCooldown = 0;
	pg.altitude = 30000;
	pg.altitudeTarget = 30000;
	pg.altitudeCooldown = 0;
	pg.planeSpeed = 1.0;
	pg.density = 0.6;
	pg.cloudSpeed = 1.0;
	pg.timeOfDay = 12;
	pg.weather = 'clear';
	pg.autoOrbit = false;
	pg.autoTime = false;
	pg.autoFly = true;
	pg.kioskMode = true;
	pg.turbulenceLevel = 'light';
	pg.pitchBias = 0;
}

export function pgRandomize() {
	pg.heading = Math.floor(Math.random() * 360);
	pg.headingTarget = pg.heading;
	pg.headingCooldown = 0;
	pg.altitude = Math.floor(15000 + Math.random() * 30000);
	pg.altitudeTarget = pg.altitude;
	pg.altitudeCooldown = 0;
	pg.density = 0.3 + Math.random() * 0.6;
	pg.cloudSpeed = 0.5 + Math.random() * 1.5;
	pg.timeOfDay = Math.random() * 24;
	const turbs: ('light' | 'moderate' | 'severe')[] = ['light', 'moderate', 'severe'];
	pg.turbulenceLevel = turbs[Math.floor(Math.random() * 3)];
	pgCycleLocation();
}

export type PlaygroundState = typeof pg;
