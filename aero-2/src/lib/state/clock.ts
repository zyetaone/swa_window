/**
 * Local wall-clock hours for a location. Pure.
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
