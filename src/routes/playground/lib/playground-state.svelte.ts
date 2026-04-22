import { type LocationId, type WeatherType } from '$lib/types';
import { LOCATIONS } from '$lib/locations';
import { getSkyState } from '$lib/utils';
import { PALETTES } from '$lib/simulation/palettes';
import type { PaletteName } from '$lib/simulation/palettes';
import { MotionEngine } from '$lib/camera/motion.svelte';
import { resolveBinding, type DeviceRole, isGroupLeader, headingOffsetForRole } from '$lib/fleet/parallax.svelte';

// Resolve binding ONCE at module load — same lifecycle as the rest of `pg`.
const initialBinding = resolveBinding();

export const pg = $state({
	activeLocation: 'dubai' as LocationId,
	timeOfDay: 12,
	weather: 'clear' as WeatherType,
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

/** Shared MotionEngine singleton */
export const motion = new MotionEngine();

/** Global reactive sky state */
export const pgSkyState = $derived(getSkyState(pg.timeOfDay));

/** Global night factor derived from time of day (0=day, 1=night) */
export const pgNightFactor = $derived.by(() => {
	const t = pg.timeOfDay;
	if (t >= 18.5 || t <= 5.5) return 1.0;
	if (t >= 7 && t <= 17) return 0.0;
	if (t < 7) return (7 - t) / 1.5;
	return (t - 17) / 1.5;
});

/** Visual Gradients — moved from +page.svelte to DRY up the UI */
export const pgBgGradient = $derived.by(() => {
	if (pg.paletteName !== 'auto' && PALETTES[pg.paletteName]) {
		const p = PALETTES[pg.paletteName];
		return `linear-gradient(180deg, ${p.sky} 0%, ${p.horizon} 60%, ${p.fog} 100%)`;
	}
	switch (pgSkyState) {
		case 'night': return 'linear-gradient(180deg, #05060f 0%, #0f1428 55%, #1a1f35 100%)';
		case 'dawn':  return 'linear-gradient(180deg, #1a1440 0%, #d96850 45%, #f0b070 70%, #d4a060 100%)';
		case 'dusk':  return 'linear-gradient(180deg, #1a1a3e 0%, #c06040 35%, #ddaa70 55%, #5a4a3a 100%)';
		default:      return 'linear-gradient(180deg, #4a90d9 0%, #7fb8ea 30%, #a4d4f4 55%, #b8c8a0 80%, #7a8860 100%)';
	}
});

export const pgHazeGradient = $derived.by(() => {
	switch (pgSkyState) {
		case 'night': return 'linear-gradient(180deg, rgba(20,28,50,0.55) 0%, rgba(10,16,35,0.4) 40%, rgba(5,8,18,0.3) 100%)';
		case 'dawn':  return 'linear-gradient(180deg, rgba(220,150,110,0.35) 0%, rgba(240,180,120,0.25) 45%, rgba(200,160,100,0.15) 100%)';
		case 'dusk':  return 'linear-gradient(180deg, rgba(200,110,90,0.4) 0%, rgba(180,90,70,0.3) 40%, rgba(100,60,50,0.2) 100%)';
		default:      return 'transparent';
	}
});

/** Cloud-layer immersion opacity */
export const pgCloudFogOpacity = $derived.by(() => {
	const dist = Math.abs(pg.altitude - 28000);
	if (dist > 6000) return 0;
	return (1 - dist / 6000) * 0.35;
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

function rotateIntervalMs(): number {
	const mins = Math.max(2, Math.min(3, pg.rotateIntervalMin));
	const jitter = (Math.random() - 0.5) * 0.4; // ±0.2 min = ±12s
	return (mins + jitter) * 60_000;
}

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

export function pgApplyRemoteLocation(locationId: LocationId, weather?: WeatherType) {
	pg.activeLocation = locationId;
	if (weather) pg.weather = weather;
	pg.altitudeTarget = 22_000 + Math.floor(Math.random() * 18_000);
	pg.altitudeCooldown = 0;
	pg.pitchBias = (Math.random() - 0.5) * 12;
	pg.orbitMajor = 0.06 + Math.random() * 0.06;
	pg.orbitMinor = 0.03 + Math.random() * 0.04;
	pg.orbitTilt = Math.random() * Math.PI;
}

export function pgReloadBinding() {
	const b = resolveBinding();
	pg.role = b.role;
	pg.groupId = b.groupId;
}

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

