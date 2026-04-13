import type { Location, LocationId } from './types';

/**
 * Location registry — SSOT. Includes SWA hub cities, international
 * destinations, and scenic/nature locations.
 */
/** Shared scene defaults by terrain archetype */
const CITY_SCENE = { fog: { dayDensity: 0.0008, nightDensity: 0.0004, dayBrightness: 0.5, nightBrightness: 0.03 }, clouds: { density: 0.5, speed: 0.4 }, terrain: { exaggeration: 1.0 } } as const;

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
	{ id: 'baltimore', name: 'Baltimore', lat: 39.1774, lon: -76.6684, utcOffset: -5, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 20000, scene: CITY_SCENE },
	{ id: 'houston', name: 'Houston', lat: 29.6454, lon: -95.2789, utcOffset: -6, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000, scene: CITY_SCENE },
	{ id: 'nashville', name: 'Nashville', lat: 36.1245, lon: -86.6782, utcOffset: -6, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000, scene: CITY_SCENE },
	{ id: 'oakland', name: 'Oakland', lat: 37.7213, lon: -122.2208, utcOffset: -8, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 20000, scene: CITY_SCENE },
	{ id: 'austin', name: 'Austin', lat: 30.1975, lon: -97.6664, utcOffset: -6, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000, scene: CITY_SCENE },
	{ id: 'atlanta', name: 'Atlanta', lat: 33.6407, lon: -84.4277, utcOffset: -5, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000, scene: CITY_SCENE },
	// Nature / scenic
	{ id: 'himalayas', name: 'Himalayas', lat: 27.9881, lon: 86.925, utcOffset: 5.75, hasBuildings: false, defaultAltitude: 38000, nightAltitude: 42000, scene: { fog: { dayDensity: 0.0002, nightDensity: 0.0001, dayBrightness: 0.55, nightBrightness: 0.005 }, clouds: { density: 0.3, speed: 0.3 }, terrain: { exaggeration: 1.5 } } },
	{ id: 'ocean', name: 'Pacific Ocean', lat: 21.3069, lon: -157.8583, utcOffset: -10, hasBuildings: false, defaultAltitude: 40000, nightAltitude: 45000, scene: { fog: { dayDensity: 0.0012, nightDensity: 0.0006, dayBrightness: 0.45, nightBrightness: 0.01 }, clouds: { density: 0.6, speed: 0.5 }, terrain: { exaggeration: 1.0 } } },
	{ id: 'desert', name: 'Sahara Desert', lat: 23.4241, lon: 25.6628, utcOffset: 2, hasBuildings: false, defaultAltitude: 35000, nightAltitude: 42000, scene: { fog: { dayDensity: 0.0003, nightDensity: 0.0001, dayBrightness: 0.6, nightBrightness: 0.005 }, clouds: { density: 0.2, speed: 0.2 }, terrain: { exaggeration: 1.3 } } },
	{ id: 'clouds', name: 'Above Clouds', lat: 35.6762, lon: 139.6503, utcOffset: 9, hasBuildings: false, defaultAltitude: 45000, nightAltitude: 48000, scene: { fog: { dayDensity: 0.0005, nightDensity: 0.0002, dayBrightness: 0.7, nightBrightness: 0.01 }, clouds: { density: 0.8, speed: 0.6 }, terrain: { exaggeration: 1.0 } } },
];

export const LOCATION_IDS = new Set<LocationId>(LOCATIONS.map((l) => l.id));
export const LOCATION_MAP = new Map<LocationId, Location>(LOCATIONS.map((l) => [l.id, l]));
