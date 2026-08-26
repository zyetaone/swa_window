/**
 * Reactive PaneSettings class ($state) and URL query parser.
 * Single source of truth for all live simulation knobs.
 */

import { LOCATIONS, Location } from './locations.js';
import { SCENE_PRESETS, type ScenePreset } from './presets.js';
import { HILLSHADE_DEFAULT, TERRAIN_EXAGGERATION, inNaipCoverage } from './tiles.js';
import { ALTITUDE_FLOOR_M, ALTITUDE_CEILING_M, daySeed } from '../display/flight/flight-path.js';
import {
	DEFAULT_WINDOW_AZIMUTH_DEG,
	DEFAULT_PITCH_DEG,
	WEATHERS,
	type Weather
} from '../display/flight/view.js';
import { resolveLocalHours } from '../display/world/sun.js';

export { Location } from './locations.js';
export { SCENE_PRESETS, type ScenePreset } from './presets.js';
export { inNaipCoverage, tileTemplates } from './tiles.js';

export interface SearchParamsSource {
	searchParams: { get(key: string): string | null };
}

function parseNum(
	params: { get(key: string): string | null },
	key: string,
	fallback: number
): number {
	const raw = params.get(key);
	if (raw === null || raw.trim() === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * The legal range of every numeric knob — the SSOT for clamping.
 */
export const KNOB_RANGE = {
	azimuthDeg: [-180, 180],
	pitchDeg: [-89, 30],
	speed: [0.1, 25.0],
	detail: [0, 1],
	floorM: [0, 20_000],
	ceilingM: [0, 20_000],
	clockOffsetH: [-12, 12],
	shade: [0, 1],
	exaggeration: [0.1, 6.0],
	wingScale: [0.3, 3.0],
	wingOffsetX: [-800, 800],
	wingOffsetY: [-800, 800],
	wingPitchDeg: [-45, 45],
	wingYawDeg: [-45, 45],
	wingRollFactor: [0, 3.0],
	cloudDensity: [0, 1.0],
	cloudSpeed: [0, 5.0],
	cloudAltitudeM: [500, 12_000],
	cloudOpacity: [0.1, 1.0],
	audioVolume: [0, 1.0],
	cesiumViirsBrightness: [0, 5.0]
} as const satisfies Record<string, readonly [number, number]>;

export type NumericKnob = keyof typeof KNOB_RANGE;

/** Wrap into -180..180 — the shortest signed bearing, not 0..360. */
function wrapSigned(deg: number): number {
	return ((((deg + 180) % 360) + 360) % 360) - 180;
}

const DEFAULT_WING_SCALE = 0.65;
const DEFAULT_WING_OFFSET_X = 0;
const DEFAULT_WING_OFFSET_Y = 0;

export class PaneSettings {
	place = $state<Location>(Location.hyderabad());
	azimuthDeg = $state<number>(DEFAULT_WINDOW_AZIMUTH_DEG);
	pitchDeg = $state<number>(DEFAULT_PITCH_DEG);
	detail = $state<number>(0);
	floorM = $state<number>(ALTITUDE_FLOOR_M);
	ceilingM = $state<number>(ALTITUDE_CEILING_M);
	/**
	 * Hours added to the destination's UTC offset, for tuning the light.
	 *
	 * An OFFSET rather than a pinned hour, because that is the version with no
	 * moving parts: sun, night factor and atmosphere all read the local hour
	 * through `resolveLocalHours`, so shifting the offset shifts every one of
	 * them together and the sky keeps advancing instead of freezing. The orbit
	 * reads raw wall-clock, so the aircraft does not teleport.
	 *
	 * DESKS ONLY. A non-zero value desyncs this pane's sky from the other two.
	 */
	clockOffsetH = $state<number>(0);
	shade = $state<number>(HILLSHADE_DEFAULT);
	/** 3D Terrain elevation mesh exaggeration (default 2.5x). */
	exaggeration = $state<number>(TERRAIN_EXAGGERATION);
	/** Optional hypsometric color relief tint layer. */
	colorRelief = $state<boolean>(false);
	reliefRamp = $state<'geographical' | 'LINZ'>('geographical');
	/** Flight speed multiplier (default 4.0x). */
	speed = $state<number>(4.0);
	/** Which way round the orbit is flown. */
	direction = $state<1 | -1>(1);
	/** Phase offset in radians from daySeed. */
	phase = $state<number>(0);

	/** Aircraft Wing alignment knobs (X, Y, Scale, Pitch, Yaw/Sweep, Roll) */
	wing = $state<boolean>(true);
	wingScale = $state<number>(DEFAULT_WING_SCALE);
	wingOffsetX = $state<number>(DEFAULT_WING_OFFSET_X);
	wingOffsetY = $state<number>(DEFAULT_WING_OFFSET_Y);
	wingPitchDeg = $state<number>(0);
	wingYawDeg = $state<number>(0);
	wingRollFactor = $state<number>(1.0);

	/** Atmospheric Cloud deck layer knobs */
	clouds = $state<boolean>(true);
	cloudDensity = $state<number>(0.75);
	cloudSpeed = $state<number>(1.0);
	cloudAltitudeM = $state<number>(3500);
	cloudOpacity = $state<number>(0.85);

	/** Cabin Window Blind & Touch controls */
	blindOpen = $state<boolean>(true);

	/** Weather conditions (clear, cloudy, rain, overcast, storm) */
	weather = $state<Weather>('clear');
	qualityMode = $state<'ultra' | 'balanced' | 'performance'>('balanced');

	/** Display Modes (flight, video, screensaver, standby) */
	displayMode = $state<'flight' | 'video' | 'screensaver' | 'standby'>('flight');
	videoUrl = $state<string>(
		'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
	);
	videoPlaylist = $state<string[]>([
		'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
		'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4'
	]);
	videoIndex = $state<number>(0);
	screensaverUrls = $state<string[]>([
		'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=80',
		'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&q=80',
		'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=80'
	]);

	/** Multi-Pi Fleet Parallax Role */
	fleetRole = $state<'solo' | 'center' | 'left' | 'right'>('solo');

	/** 3D Geospatial Engine (maplibre | cesium) */
	engine = $state<'maplibre' | 'cesium'>('maplibre');
	cesiumProvider = $state<'sentinel' | 'gibs' | 'osm'>('sentinel');
	cesiumLighting = $state<boolean>(false);
	cesiumAtmosphere = $state<boolean>(true);
	cesiumViirsBrightness = $state<number>(0.85);

	/** Cabin Ambient Soundscape & Audio Playlist */
	audioEnabled = $state<boolean>(false);
	audioVolume = $state<number>(0.5);
	audioMode = $state<'synth' | 'playlist'>('synth');
	audioPlaylist = $state<string[]>([
		'https://actions.google.com/sounds/v1/weather/rain_heavy.ogg',
		'https://actions.google.com/sounds/v1/weather/wind_breeze.ogg'
	]);
	audioTrackIndex = $state<number>(0);

	constructor(initial?: Partial<PaneSettings>) {
		if (initial) Object.assign(this, initial);
	}

	/**
	 * Move to a location, and bring everything the location DEFINES with it.
	 *
	 * `detail`, `floorM`, `ceilingM` and `phase` are not independent settings —
	 * they are facts about the place. Setting `place` alone leaves them
	 * describing the previous one, and `detail` is the expensive case: it gates
	 * the US-only USGS layer, so carrying Denver's `1` across to Hyderabad
	 * mounts a layer with no coverage there and streams 404s at the tile server
	 * indefinitely. That exact failure has now regressed four times, each time
	 * because a caller set some of these fields and not the rest.
	 *
	 * So there is one gate. Call this, never assign `place` directly.
	 */
	setPlace(place: Location): void {
		this.place = place;
		this.phase = daySeed(place) * Math.PI * 2;
		this.detail = inNaipCoverage(place) ? 1 : 0;
		this.floorM = place.climbFloorM;
		this.ceilingM = place.climbCeilingM;
	}

	applyUrl(url: SearchParamsSource): void {
		const place = Location.byId(url.searchParams.get('place'));
		this.setPlace(place);
		this.azimuthDeg = parseNum(url.searchParams, 'azimuth', DEFAULT_WINDOW_AZIMUTH_DEG);
		this.pitchDeg = parseNum(url.searchParams, 'pitch', DEFAULT_PITCH_DEG);
		this.detail = parseNum(url.searchParams, 'detail', this.detail);
		this.floorM = parseNum(url.searchParams, 'floor', this.floorM);
		this.ceilingM = parseNum(url.searchParams, 'ceiling', this.ceilingM);
		this.clockOffsetH = parseNum(url.searchParams, 'clock', 0);
		this.shade = parseNum(url.searchParams, 'shade', HILLSHADE_DEFAULT);
		this.exaggeration = parseNum(url.searchParams, 'exaggeration', TERRAIN_EXAGGERATION);
		const crParam = url.searchParams.get('colorRelief');
		if (crParam !== null) this.colorRelief = crParam === '1' || crParam === 'true';
		const rampParam = url.searchParams.get('ramp');
		if (rampParam === 'LINZ' || rampParam === 'geographical') this.reliefRamp = rampParam;
		this.speed = parseNum(url.searchParams, 'speed', 4.0);
		this.wingScale = parseNum(url.searchParams, 'wingScale', DEFAULT_WING_SCALE);
		this.wingOffsetX = parseNum(url.searchParams, 'wingX', DEFAULT_WING_OFFSET_X);
		this.wingOffsetY = parseNum(url.searchParams, 'wingY', DEFAULT_WING_OFFSET_Y);
		this.wingPitchDeg = parseNum(url.searchParams, 'wingPitch', 0);
		this.wingRollFactor = parseNum(url.searchParams, 'wingRoll', 1.0);
		const cloudsParam = url.searchParams.get('clouds');
		if (cloudsParam !== null) this.clouds = cloudsParam !== '0' && cloudsParam !== 'false';
		this.cloudDensity = parseNum(url.searchParams, 'cloudDensity', 0.75);
		this.cloudSpeed = parseNum(url.searchParams, 'cloudSpeed', 1.0);
		this.cloudAltitudeM = parseNum(url.searchParams, 'cloudAlt', 3500);
		this.cloudOpacity = parseNum(url.searchParams, 'cloudOpacity', 0.85);

		const blindParam = url.searchParams.get('blind');
		if (blindParam !== null)
			this.blindOpen = blindParam !== 'closed' && blindParam !== '0' && blindParam !== 'false';

		const weatherParam = url.searchParams.get('weather');
		if (weatherParam && (WEATHERS as readonly string[]).includes(weatherParam)) {
			this.weather = weatherParam as Weather;
		}

		const qualityParam = url.searchParams.get('quality');
		if (qualityParam === 'ultra' || qualityParam === 'balanced' || qualityParam === 'performance') {
			this.qualityMode = qualityParam;
		}

		const modeParam = url.searchParams.get('mode');
		if (
			modeParam === 'flight' ||
			modeParam === 'video' ||
			modeParam === 'screensaver' ||
			modeParam === 'standby'
		) {
			this.displayMode = modeParam;
		}

		const roleParam = url.searchParams.get('role');
		if (
			roleParam === 'solo' ||
			roleParam === 'center' ||
			roleParam === 'left' ||
			roleParam === 'right'
		) {
			this.fleetRole = roleParam;
		}

		const engineParam = url.searchParams.get('engine');
		if (engineParam === 'maplibre' || engineParam === 'cesium') {
			this.engine = engineParam;
		}

		/**
		 * Last, because every assignment above is unconditional — `clockOffsetH`
		 * falls back to 0, `speed` to 4.0 — so a preset applied first would be
		 * overwritten by the defaults of params nobody passed.
		 *
		 * ponytail: the cost is that an explicit param LOSES to a preset in the
		 * same URL (`?preset=storm-transit&place=denver` stays over Chicago). If
		 * that combination is ever wanted, the fix is to make the block above
		 * fall back to the current value rather than to a constant.
		 */
		const presetParam = url.searchParams.get('preset');
		if (presetParam) this.applyPreset(presetParam);
	}

	reset(): void {
		this.azimuthDeg = DEFAULT_WINDOW_AZIMUTH_DEG;
		this.pitchDeg = DEFAULT_PITCH_DEG;
		this.shade = HILLSHADE_DEFAULT;
		this.exaggeration = TERRAIN_EXAGGERATION;
		this.colorRelief = false;
		this.reliefRamp = 'geographical';
		this.speed = 4.0;
		this.wingScale = DEFAULT_WING_SCALE;
		this.wingOffsetX = DEFAULT_WING_OFFSET_X;
		this.wingOffsetY = DEFAULT_WING_OFFSET_Y;
		this.wingPitchDeg = 0;
		this.wingYawDeg = 0;
		this.wingRollFactor = 1.0;
		this.clouds = true;
		this.cloudDensity = 0.75;
		this.cloudSpeed = 1.0;
		this.cloudAltitudeM = 3500;
		this.cloudOpacity = 0.85;
		this.blindOpen = true;
		this.weather = 'clear';
		this.displayMode = 'flight';
		this.engine = 'maplibre';
	}

	set(key: NumericKnob, value: number): void {
		if (!Number.isFinite(value)) return;
		if (key === 'azimuthDeg') {
			this.azimuthDeg = wrapSigned(value);
			return;
		}
		const [lo, hi] = KNOB_RANGE[key];
		this[key] = Math.min(hi, Math.max(lo, value));
	}

	reverse(): void {
		this.direction = this.direction === 1 ? -1 : 1;
	}

	/**
	 * Compose the scene from a preset.
	 *
	 * `localHour` is resolved here rather than stored, because the camera takes
	 * an OFFSET from real local time, not an absolute hour — see the note on
	 * ScenePreset.config.localHour for what that cost the six authored presets.
	 *
	 * The offset lands on a 15-minute grid so a fleet URL stays a fleet URL:
	 * three panes opening `?preset=golden-hour` within a few minutes of each
	 * other derive the SAME offset and therefore the same sun. Panes started
	 * more than ~7 minutes apart can still land a bucket apart — this is an
	 * operator action on a pane, not a derived quantity, so that ceiling is
	 * accepted rather than engineered away.
	 */
	applyPreset(presetOrId: ScenePreset | string, wallSec: number = Date.now() / 1000): void {
		const preset =
			typeof presetOrId === 'string' ? SCENE_PRESETS.find((p) => p.id === presetOrId) : presetOrId;
		if (!preset) return;

		const { localHour, placeId, wingVisible, ...rest } = preset.config;

		if (placeId) {
			const loc = LOCATIONS.find((l) => l.id === placeId);
			if (loc) this.setPlace(loc);
		}

		// setPlace first: the offset is relative to the DESTINATION's local time.
		if (localHour !== undefined) {
			const nowH = resolveLocalHours(wallSec, this.place.utcOffset);
			// Wrap to shortest signed offset in [-12, 12] on a 15-minute grid
			const rawDelta = ((((localHour - nowH) % 24) + 36) % 24) - 12;
			this.clockOffsetH = Math.round(rawDelta * 4) / 4;
		}

		for (const [key, value] of Object.entries(rest)) {
			if (value !== undefined) (this as Record<string, unknown>)[key] = value;
		}
		if (wingVisible !== undefined) this.wing = wingVisible;
	}

	nudge(key: NumericKnob, delta: number): void {
		this.set(key, this[key] + delta);
	}
}

export function createSettings(initial?: Partial<PaneSettings>): PaneSettings {
	return new PaneSettings(initial);
}

export function readSettings(url: SearchParamsSource): PaneSettings {
	const s = new PaneSettings();
	s.applyUrl(url);
	return s;
}
