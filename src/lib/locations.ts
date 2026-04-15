import type { Location, LocationId } from './types';

/**
 * Location registry — SSOT. Includes SWA hub cities, international
 * destinations, and scenic/nature locations.
 */

// ─── Scene archetypes ────────────────────────────────────────────────────────
// Per-terrain defaults bundled by character. Fog density + atmospheric haze
// intensity are tuned to match the real-world feel of the location archetype.
//
// Haze intensity multiplier (1.0 = baseline city haze):
//   city      1.00  pollution + humidity → noticeable atmospheric layer
//   mountain  0.55  high-altitude crystal-clear air, distant peaks crisp
//   ocean     1.30  sea moisture creates dense atmospheric perspective
//   desert    0.50  bone-dry air gives near-perfect distant clarity
//   clouds    0.35  you're in the cloud layer — ambient diffuse, not haze

const CITY_SCENE = {
	fog: { dayDensity: 0.0014, nightDensity: 0.0006, dayBrightness: 0.55, nightBrightness: 0.04 },
	clouds: { density: 0.5, speed: 0.4 },
	terrain: { exaggeration: 1.0 },
	haze: { intensity: 1.0 },
} as const;

const MOUNTAIN_SCENE = {
	fog: { dayDensity: 0.0003, nightDensity: 0.00015, dayBrightness: 0.6, nightBrightness: 0.008 },
	clouds: { density: 0.3, speed: 0.3 },
	terrain: { exaggeration: 1.5 },
	haze: { intensity: 0.55 },
} as const;

const OCEAN_SCENE = {
	fog: { dayDensity: 0.0018, nightDensity: 0.0008, dayBrightness: 0.5, nightBrightness: 0.012 },
	clouds: { density: 0.6, speed: 0.5 },
	terrain: { exaggeration: 1.0 },
	haze: { intensity: 1.3 },
} as const;

const DESERT_SCENE = {
	fog: { dayDensity: 0.0004, nightDensity: 0.00015, dayBrightness: 0.65, nightBrightness: 0.008 },
	clouds: { density: 0.2, speed: 0.2 },
	terrain: { exaggeration: 1.3 },
	haze: { intensity: 0.5 },
} as const;

const CLOUDS_SCENE = {
	fog: { dayDensity: 0.0007, nightDensity: 0.00025, dayBrightness: 0.75, nightBrightness: 0.012 },
	clouds: { density: 0.8, speed: 0.6 },
	terrain: { exaggeration: 1.0 },
	haze: { intensity: 0.35 },
} as const;

// ─── Locations ───────────────────────────────────────────────────────────────

export const LOCATIONS: Location[] = [
	// International destinations
	{ id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708, utcOffset: 4, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 15000, scene: CITY_SCENE },
	{ id: 'mumbai', name: 'Mumbai', lat: 19.076, lon: 72.8777, utcOffset: 5.5, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000, scene: CITY_SCENE },
	{ id: 'hyderabad', name: 'Hyderabad', lat: 17.4435, lon: 78.3772, utcOffset: 5.5, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 20000, scene: CITY_SCENE },
	// Southwest Airlines hubs
	{ id: 'dallas', name: 'Dallas', lat: 32.7767, lon: -96.797, utcOffset: -6, hasBuildings: true, defaultAltitude: 32000, nightAltitude: 25000, scene: CITY_SCENE },
	{ id: 'phoenix', name: 'Phoenix', lat: 33.4352, lon: -112.0101, utcOffset: -7, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000, scene: CITY_SCENE },
	{ id: 'las_vegas', name: 'Las Vegas', lat: 36.1699, lon: -115.1398, utcOffset: -8, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 18000, scene: CITY_SCENE },
	{ id: 'denver', name: 'Denver', lat: 39.8561, lon: -104.6737, utcOffset: -7, hasBuildings: true, defaultAltitude: 32000, nightAltitude: 24000, scene: CITY_SCENE },
	{ id: 'chicago_midway', name: 'Chicago Midway', lat: 41.7868, lon: -87.7522, utcOffset: -6, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000, scene: CITY_SCENE },
	// Nature / scenic
	{ id: 'himalayas', name: 'Himalayas', lat: 27.9881, lon: 86.925, utcOffset: 5.75, hasBuildings: false, defaultAltitude: 38000, nightAltitude: 42000, scene: MOUNTAIN_SCENE },
	{ id: 'ocean', name: 'Pacific Ocean', lat: 21.3069, lon: -157.8583, utcOffset: -10, hasBuildings: false, defaultAltitude: 40000, nightAltitude: 45000, scene: OCEAN_SCENE },
	{ id: 'desert', name: 'Sahara Desert', lat: 23.4241, lon: 25.6628, utcOffset: 2, hasBuildings: false, defaultAltitude: 35000, nightAltitude: 42000, scene: DESERT_SCENE },
	{ id: 'clouds', name: 'Above Clouds', lat: 35.6762, lon: 139.6503, utcOffset: 9, hasBuildings: false, defaultAltitude: 45000, nightAltitude: 48000, scene: CLOUDS_SCENE },
];

export const LOCATION_IDS = new Set<LocationId>(LOCATIONS.map((l) => l.id));
export const LOCATION_MAP = new Map<LocationId, Location>(LOCATIONS.map((l) => [l.id, l]));
