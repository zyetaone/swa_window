import { type LocationId, type WeatherType } from '$lib/types';
import { LOCATIONS } from '$lib/locations';
import type { PaletteName } from '../palettes';

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
	cloudRenderer: 'css3d' as 'css3d' | 'css',
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
});

if (typeof window !== 'undefined') {
	pg.nextLocationChange = performance.now() + 120_000 + Math.random() * 120_000;
	pg.heading = Math.floor(Math.random() * 360);
	pg.headingTarget = pg.heading;
}

export const ALT_HOLD_SEC = 6;
const ALT_LERP_RATE = 0.4;
export const HDG_HOLD_SEC = 4;
const HDG_LERP_RATE = 0.6;
const CLOUD_DECK_ALT = 28_000;

export function pgTick(dt: number, now: number, isBoosting = false) {
	if (pg.autoTime) {
		pg.timeOfDay = (pg.timeOfDay + dt * 0.5) % 24;
	}

	if (pg.autoFly || isBoosting) {
		if (pg.kioskMode && now > pg.nextLocationChange) {
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
	const ids = LOCATIONS.map(l => l.id);
	const idx = ids.indexOf(pg.activeLocation);
	pg.activeLocation = ids[(idx + 1) % ids.length];

	pg.altitudeTarget = 22_000 + Math.floor(Math.random() * 18_000);
	pg.altitudeCooldown = 0;
	pg.pitchBias = (Math.random() - 0.5) * 12;
	pg.orbitMajor = 0.06 + Math.random() * 0.06;
	pg.orbitMinor = 0.03 + Math.random() * 0.04;
	pg.orbitTilt = Math.random() * Math.PI;
	const turbs: ('light' | 'moderate' | 'severe')[] = ['light', 'light', 'light', 'moderate', 'moderate', 'severe'];
	pg.turbulenceLevel = turbs[Math.floor(Math.random() * turbs.length)];

	if (now) {
		pg.nextLocationChange = now + 120_000 + Math.random() * 120_000;
	}
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
