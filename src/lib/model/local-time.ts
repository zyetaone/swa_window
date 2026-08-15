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

/** Civil hours [0, 24) in `timeZone` at `now`. */
export function localHoursInTimeZone(
	timeZone: string,
	now: Date = new Date(),
): number | null {
	if (!timeZone || typeof timeZone !== 'string') return null;
	try {
		const parts = new Intl.DateTimeFormat('en-GB', {
			timeZone,
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
			hourCycle: 'h23',
		}).formatToParts(now);
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
