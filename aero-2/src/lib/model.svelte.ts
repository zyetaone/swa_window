/**
 * Root simulation state — config, location, flight engine, DTOs, context DI.
 */
import { getContext, setContext } from 'svelte';
import { type AtmosphereState, type ImagerySelection } from '#lib/rules.js';
import { FlightEngine } from '#lib/flight.svelte.js';

export { FlightEngine };

// ── DTOs (model ↔ world boundary) ────────────────────────────────────────────

export class CameraPose {
	constructor(
		readonly lat: number,
		readonly lon: number,
		readonly altitudeM: number,
		readonly headingDeg: number,
		readonly pitchDeg: number,
	) {}
}

/**
 * The model → world boundary: six primary numbers, nothing derived.
 *
 * Atmosphere, imagery and night factor used to ride along here, all three
 * computed from `camera.altitudeM` and `timeOfDay`. Derived state on a boundary
 * can disagree with its own inputs, and on three machines that disagreement is a
 * torn window no single-machine test would catch. The world derives them now.
 */
export class GlobeSyncSlice {
	constructor(
		readonly camera: CameraPose,
		readonly timeOfDay: number,
	) {}
}

// ── Location ─────────────────────────────────────────────────────────────────

export class Location {
	constructor(
		readonly id: string,
		readonly lat: number,
		readonly lon: number,
		readonly timeZone: string,
		readonly utcOffset: number,
	) {}

	static hyderabad(): Location {
		return new Location('hyderabad', 17.385, 78.4867, 'Asia/Kolkata', 5.5);
	}
}

// ── Config ─────────────────────────────────────────────────────────────────────

export class CameraConfig {
	orbit = $state({
		// ~6 min per orbit. See orbitRate(): rate = driftRate * flightSpeed / meanRadius.
		driftRate: 3.42e-4,
		majorMin: 0.08,
		majorMax: 0.25,
		breathePeriod: 180,
	});

	view = $state({
		pitchDeg: -18,
	});

	flightSpeed = $state(6.0);
}

export class DirectorConfig {
	daylight = $state({
		syncIntervalMs: 60_000,
		timeZoneOverride: '',
	});
}

export class ConfigTree {
	readonly camera = new CameraConfig();
	readonly director = new DirectorConfig();
}

// ── Local time ─────────────────────────────────────────────────────────────────

const _fmtCache = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
	const hit = _fmtCache.get(timeZone);
	if (hit !== undefined) return hit;
	let fmt: Intl.DateTimeFormat | null = null;
	try {
		fmt = new Intl.DateTimeFormat('en-GB', {
			timeZone,
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
			hourCycle: 'h23',
		});
	} catch {
		fmt = null;
	}
	_fmtCache.set(timeZone, fmt);
	return fmt;
}

function localHoursInTimeZone(timeZone: string, now: Date = new Date()): number | null {
	try {
		const fmt = formatterFor(timeZone);
		if (!fmt) return null;
		const parts = fmt.formatToParts(now);
		const num = (type: Intl.DateTimeFormatPartTypes): number => {
			const v = parts.find((p) => p.type === type)?.value;
			return v != null ? Number(v) : NaN;
		};
		const h = num('hour');
		const m = num('minute');
		const s = num('second');
		if (![h, m, s].every(Number.isFinite)) return null;
		return ((h + m / 60 + s / 3600) % 24 + 24) % 24;
	} catch {
		return null;
	}
}

function localHoursFromUtcOffset(utcOffsetHours: number, now: Date = new Date()): number {
	const utc = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
	return ((utc + utcOffsetHours) % 24 + 24) % 24;
}

export function resolveLocalHours(opts: {
	timeZone?: string;
	utcOffset?: number;
	zoneOverride?: string;
	now?: Date;
}): number {
	const now = opts.now ?? new Date();
	const override = opts.zoneOverride?.trim();
	if (override) {
		const h = localHoursInTimeZone(override, now);
		if (h != null) return h;
	}
	if (opts.timeZone) {
		const h = localHoursInTimeZone(opts.timeZone, now);
		if (h != null) return h;
	}
	if (typeof opts.utcOffset === 'number' && Number.isFinite(opts.utcOffset)) {
		return localHoursFromUtcOffset(opts.utcOffset, now);
	}
	return localHoursFromUtcOffset(0, now);
}

// ── AeroWindow + context ───────────────────────────────────────────────────────

const AERO_WINDOW_KEY = Symbol('aero-window');

export class AeroWindow {
	readonly config = new ConfigTree();
	readonly location: Location;
	readonly flight: FlightEngine;

	constructor(location: Location = Location.hyderabad()) {
		this.location = location;
		this.flight = new FlightEngine(this.config, location);
	}

	tick(): void {
		this.flight.tick();
	}

	frame(): GlobeSyncSlice {
		return this.flight.frame();
	}
}

export function createAeroWindow(location?: Location): AeroWindow {
	const model = new AeroWindow(location);
	setContext(AERO_WINDOW_KEY, model);
	return model;
}

export function useAeroWindow(): AeroWindow {
	return getContext<AeroWindow>(AERO_WINDOW_KEY);
}
