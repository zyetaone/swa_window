/**
 * Location registry — authored content.
 *
 * SSOT for locations, scene archetypes, and the LocationId union. Adding a
 * location here widens LocationId automatically — no other file edits needed.
 *
 * Lives under `content/` per docs/standards.md Rule 0 (content vs control):
 * this file is authored content a curator could edit. The control plane
 * (engines, compositor, shell) imports from `$content/locations`.
 */

// ─── Scene shape ─────────────────────────────────────────────────────────────

export interface SceneDefaults {
	fog: { dayDensity: number; nightDensity: number; dayBrightness: number; nightBrightness: number };
	clouds: { density: number; speed: number };
	terrain: { exaggeration: number };
	/**
	 * Multiplier for the screen-vertical atmospheric-haze effect.
	 * - 1.0  = baseline (city default)
	 * - <1.0 = clearer air (mountains, dry desert)
	 * - >1.0 = thicker air (humid coast, sea moisture)
	 */
	haze: { intensity: number };
}

export interface Location {
	id: LocationId;
	name: string;
	lat: number;
	lon: number;
	utcOffset: number;
	hasBuildings: boolean;
	defaultAltitude: number;
	nightAltitude: number;
	scene: SceneDefaults;
}

// Shape used to validate LOCATIONS_DATA (id kept as string so satisfies can check
// everything else without creating a circular reference through LocationId).
type LocationShape = { id: string; name: string; lat: number; lon: number; utcOffset: number; hasBuildings: boolean; defaultAltitude: number; nightAltitude: number; scene: SceneDefaults };


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

// fog.nightBrightness was 0.008–0.04 across scenes — those non-zero values
// produced the WHITE HORIZON BAND at night because Cesium's fog renders
// as (fog.color × minimumBrightness) at distance and the default fog.color
// is white. With any positive minimumBrightness at night, dark sky pixels
// near the horizon got lifted toward white, producing a faint band.
// Zeroing nightBrightness eliminates the minimum-brightness floor. Fog
// density at night is still non-zero so atmospheric perspective (depth
// cue at distance) is preserved — only the WHITE FLOOR is removed.
const CITY_SCENE = {
	fog: { dayDensity: 0.0014, nightDensity: 0.0006, dayBrightness: 0.55, nightBrightness: 0 },
	clouds: { density: 0.5, speed: 0.4 },
	terrain: { exaggeration: 1.0 },
	haze: { intensity: 1.0 },
} as const;

const MOUNTAIN_SCENE = {
	fog: { dayDensity: 0.0003, nightDensity: 0.00015, dayBrightness: 0.6, nightBrightness: 0 },
	clouds: { density: 0.3, speed: 0.3 },
	terrain: { exaggeration: 1.5 },
	haze: { intensity: 0.55 },
} as const;

const OCEAN_SCENE = {
	fog: { dayDensity: 0.0018, nightDensity: 0.0008, dayBrightness: 0.5, nightBrightness: 0 },
	clouds: { density: 0.6, speed: 0.5 },
	terrain: { exaggeration: 1.0 },
	haze: { intensity: 1.3 },
} as const;

const DESERT_SCENE = {
	fog: { dayDensity: 0.0004, nightDensity: 0.00015, dayBrightness: 0.65, nightBrightness: 0 },
	clouds: { density: 0.2, speed: 0.2 },
	terrain: { exaggeration: 1.3 },
	haze: { intensity: 0.5 },
} as const;

const CLOUDS_SCENE = {
	fog: { dayDensity: 0.0007, nightDensity: 0.00025, dayBrightness: 0.75, nightBrightness: 0 },
	clouds: { density: 0.8, speed: 0.6 },
	terrain: { exaggeration: 1.0 },
	haze: { intensity: 0.35 },
} as const;

// ─── Locations ───────────────────────────────────────────────────────────────

// `as const` preserves string literal types on each `id` for LocationId derivation.
// `satisfies` validates every entry has the required shape without widening.
const LOCATIONS_DATA = [
	// International destinations
	//
	// nightAltitude was originally a "passenger window descending into city"
	// height (15–25kft). At those altitudes the camera FOV shrinks and the
	// VIIRS / road-mask footprint at the frame edges falls outside view —
	// reads as "lights going off" once the boot altitude finishes lerping
	// down. Bumped night targets up to ~28–35kft so the camera holds a
	// wide-area overview of the city light footprint.
	{ id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708, utcOffset: 4, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 28000, scene: CITY_SCENE },
	{ id: 'mumbai', name: 'Mumbai', lat: 19.076, lon: 72.8777, utcOffset: 5.5, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 32000, scene: CITY_SCENE },
	{ id: 'hyderabad', name: 'Hyderabad', lat: 17.4435, lon: 78.3772, utcOffset: 5.5, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 30000, scene: CITY_SCENE },
	// Southwest Airlines hubs
	{ id: 'dallas', name: 'Dallas', lat: 32.7767, lon: -96.797, utcOffset: -6, hasBuildings: true, defaultAltitude: 32000, nightAltitude: 34000, scene: CITY_SCENE },
	{ id: 'phoenix', name: 'Phoenix', lat: 33.4352, lon: -112.0101, utcOffset: -7, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 32000, scene: CITY_SCENE },
	{ id: 'las_vegas', name: 'Las Vegas', lat: 36.1699, lon: -115.1398, utcOffset: -8, hasBuildings: true, defaultAltitude: 28000, nightAltitude: 30000, scene: CITY_SCENE },
	{ id: 'denver', name: 'Denver', lat: 39.8561, lon: -104.6737, utcOffset: -7, hasBuildings: true, defaultAltitude: 32000, nightAltitude: 34000, scene: CITY_SCENE },
	{ id: 'chicago_midway', name: 'Chicago Midway', lat: 41.7868, lon: -87.7522, utcOffset: -6, hasBuildings: true, defaultAltitude: 30000, nightAltitude: 32000, scene: CITY_SCENE },
	// Nature / scenic
	{ id: 'himalayas', name: 'Himalayas', lat: 27.9881, lon: 86.925, utcOffset: 5.75, hasBuildings: false, defaultAltitude: 38000, nightAltitude: 42000, scene: MOUNTAIN_SCENE },
	{ id: 'ocean', name: 'Pacific Ocean', lat: 21.3069, lon: -157.8583, utcOffset: -10, hasBuildings: false, defaultAltitude: 40000, nightAltitude: 45000, scene: OCEAN_SCENE },
	{ id: 'desert', name: 'Sahara Desert', lat: 23.4241, lon: 25.6628, utcOffset: 2, hasBuildings: false, defaultAltitude: 35000, nightAltitude: 42000, scene: DESERT_SCENE },
	{ id: 'clouds', name: 'Above Clouds', lat: 35.6762, lon: 139.6503, utcOffset: 9, hasBuildings: false, defaultAltitude: 45000, nightAltitude: 48000, scene: CLOUDS_SCENE },
] as const satisfies ReadonlyArray<LocationShape>;

/**
 * Derived union of all registered location IDs.
 * Widens automatically when you add an entry to LOCATIONS_DATA — no manual
 * edit of types.ts required.
 */
export type LocationId = (typeof LOCATIONS_DATA)[number]['id'];

export const LOCATIONS = LOCATIONS_DATA as ReadonlyArray<Location>;
export const LOCATION_IDS = new Set<LocationId>(LOCATIONS_DATA.map((l) => l.id));
export const LOCATION_MAP = new Map<LocationId, Location>(LOCATIONS_DATA.map((l) => [l.id, l as Location]));

/**
 * Runtime type guard — mirrors isValidWeather / isValidDisplayMode in
 * $lib/types. Use at the trust boundary (fleet messages, URL params,
 * HTTP route params) instead of casting strings to LocationId via
 * `as never`.
 */
export function isValidLocation(v: unknown): v is LocationId {
	return typeof v === 'string' && (LOCATION_IDS as ReadonlySet<string>).has(v);
}

/**
 * Approximate ground elevation (metres AMSL) per location. Cesium drapes
 * VIIRS / roads / buildings on real terrain at this height; Three geo-anchored
 * night lights (bokeh, neon, glow dome) must anchor at the SAME elevation
 * (passed as the `altM` of geoToCartesian/enuAnchorMatrix) or they float off
 * the lit ground. Rough city-centre values are plenty — the registration error
 * they remove is ~hundreds of metres; sub-100 m precision is invisible from the
 * air. Defaults to 0 (sea level) for anything unlisted.
 */
const GROUND_ALT_M: Partial<Record<LocationId, number>> = {
	hyderabad: 542,
	denver: 1609,
	las_vegas: 620,
	phoenix: 331,
	dallas: 131,
	chicago_midway: 188,
	himalayas: 4200,
	desert: 320,
	dubai: 5,
	mumbai: 14,
	clouds: 40,
};

/** Ground elevation (m AMSL) for a location; 0 if unlisted. */
export function groundAltM(id: LocationId): number {
	return GROUND_ALT_M[id] ?? 0;
}
