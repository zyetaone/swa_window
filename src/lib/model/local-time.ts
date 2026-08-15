/**
 * Location-local civil time — IANA timezone aware.
 *
 * Fixed `utcOffset` hours are wrong half the year for DST zones (Dallas is
 * UTC−6 standard / UTC−5 daylight). Real Time must follow the depicted
 * city's calendar, so we resolve via `Intl` + IANA zone id.
 *
 * Fallback: if the zone is invalid (typo / ancient runtime), use the
 * location's fixed `utcOffset` hours so the wall still shows something
 * coherent rather than NaN.
 */

/**
 * Formatter cache, keyed by IANA zone.
 *
 * `new Intl.DateTimeFormat(...)` is genuinely expensive — it resolves locale
 * data on every construction — while the resulting formatter is stateless and
 * safe to reuse across instants. Building one per call was fine for the
 * original single-location use, but the director now scores EVERY candidate
 * destination by its own local hour on each hop, so the cost went from one
 * construction to one per location.
 *
 * Bounded by the location catalogue (a dozen zones), so this is a lookup table,
 * not an unbounded cache. A failed construction is cached as null too, so an
 * invalid zone id costs one throw rather than one per call forever.
 */
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
		fmt = null; // RangeError on unknown IANA id
	}
	_fmtCache.set(timeZone, fmt);
	return fmt;
}

/** Civil hours [0, 24) in `timeZone` at `now`. */
export function localHoursInTimeZone(
	timeZone: string,
	now: Date = new Date(),
): number | null {
	if (!timeZone || typeof timeZone !== 'string') return null;
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
		// RangeError on unknown IANA id
		return null;
	}
}

/** Fixed-offset hours [0, 24) — last-resort / test path. */
export function localHoursFromUtcOffset(utcOffsetHours: number, now: Date = new Date()): number {
	const utc = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
	return ((utc + utcOffsetHours) % 24 + 24) % 24;
}

/**
 * Prefer IANA zone; fall back to fixed offset; finally UTC.
 * `zoneOverride` (admin) wins when non-empty.
 */
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
