import type { Location, LocationId } from './types';

export const LOCATIONS: Location[] = [
	{ id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708, utcOffset: 4, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 15000 },
	{ id: 'mumbai', name: 'Mumbai', lat: 19.076, lon: 72.8777, utcOffset: 5.5, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000 },
	{ id: 'hyderabad', name: 'Hyderabad', lat: 17.4435, lon: 78.3772, utcOffset: 5.5, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 20000 },
	{ id: 'dallas', name: 'Dallas', lat: 32.7767, lon: -96.7970, utcOffset: -6, hasBuildings: true, defaultAltitude: 32000, nightAltitude: 25000 },
	{ id: 'phoenix', name: 'Phoenix', lat: 33.4352, lon: -112.0101, utcOffset: -7, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000 },
	{ id: 'las_vegas', name: 'Las Vegas', lat: 36.1699, lon: -115.1398, utcOffset: -8, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 18000 },
	// Southwest Airlines hubs
	{ id: 'denver', name: 'Denver', lat: 39.8561, lon: -104.6737, utcOffset: -7, hasBuildings: true, defaultAltitude: 32000, nightAltitude: 24000 },
	{ id: 'chicago_midway', name: 'Chicago Midway', lat: 41.7868, lon: -87.7522, utcOffset: -6, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000 },
	{ id: 'baltimore', name: 'Baltimore', lat: 39.1774, lon: -76.6684, utcOffset: -5, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 20000 },
	{ id: 'houston', name: 'Houston', lat: 29.6454, lon: -95.2789, utcOffset: -6, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000 },
	{ id: 'nashville', name: 'Nashville', lat: 36.1245, lon: -86.6782, utcOffset: -6, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000 },
	{ id: 'oakland', name: 'Oakland', lat: 37.7213, lon: -122.2208, utcOffset: -8, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 20000 },
	{ id: 'austin', name: 'Austin', lat: 30.1975, lon: -97.6664, utcOffset: -6, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000 },
	{ id: 'atlanta', name: 'Atlanta', lat: 33.6407, lon: -84.4277, utcOffset: -5, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 22000 },
	// Nature / scenic
	{ id: 'himalayas', name: 'Himalayas', lat: 27.9881, lon: 86.925, utcOffset: 5.75, hasBuildings: false, defaultAltitude: 38000, nightAltitude: 42000 },
	{ id: 'ocean', name: 'Pacific Ocean', lat: 21.3069, lon: -157.8583, utcOffset: -10, hasBuildings: false, defaultAltitude: 40000, nightAltitude: 45000 },
	{ id: 'desert', name: 'Sahara Desert', lat: 23.4241, lon: 25.6628, utcOffset: 2, hasBuildings: false, defaultAltitude: 35000, nightAltitude: 42000 },
	{ id: 'clouds', name: 'Above Clouds', lat: 35.6762, lon: 139.6503, utcOffset: 9, hasBuildings: false, defaultAltitude: 45000, nightAltitude: 48000 },
];

export const LOCATION_IDS = new Set<LocationId>(LOCATIONS.map(l => l.id));
export const LOCATION_MAP = new Map<LocationId, Location>(LOCATIONS.map(l => [l.id, l]));
