/**
 * Location catalog and lookup for fielded kiosks and simulation targets.
 */

/**
 * UTC offset in hours for an IANA zone at a given instant, DST included.
 *
 * The offset used to be typed in by hand beside the zone name, and it was
 * wrong: Denver carried -7 while `America/Denver` is -6 from March to November,
 * so for two thirds of the year that kiosk's clock, night curve, sun position
 * and hillshade bearing were all an hour out. Six of the twelve places below
 * observe DST, so hand-typed offsets would be wrong somewhere for most of the
 * year. The zone string was already stored and already unused; this derives the
 * number from it instead of duplicating it.
 *
 * Determinism holds: every Pi resolves the same zone at the same instant from
 * the same tz database, so all three agree.
 */
function offsetHoursFor(timeZone: string, atMs: number): number {
	const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
		.formatToParts(new Date(atMs))
		.find((p) => p.type === 'timeZoneName')?.value;
	// "GMT-06:00", "GMT+05:30", or plain "GMT" at exactly zero.
	const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name ?? '');
	if (!m) return 0;
	return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60);
}

export class Location {
	/** Hours ahead of UTC right now, DST included. Derived, never typed in. */
	readonly utcOffset: number;

	constructor(
		readonly id: string,
		readonly name: string,
		readonly lat: number,
		readonly lon: number,
		readonly timeZone: string,
		/** Mean terrain height, metres MSL. */
		readonly groundElevationM: number,
		/** Climb envelope, metres ABOVE GROUND. Floor must clear local peaks. */
		readonly climbFloorM: number,
		readonly climbCeilingM: number,
		atMs: number = Date.now()
	) {
		this.utcOffset = offsetHoursFor(timeZone, atMs);
	}

	/**
	 * The catalog, carried over from v1's `content/locations/catalog.ts`.
	 *
	 * A flat list rather than one static factory per place: twelve near-identical
	 * factories is the shape that invites a thirteenth to be added in one place
	 * and forgotten in another. `byId` and `all` read this and nothing else.
	 *
	 * `climbFloorM` is metres ABOVE GROUND and has to clear the local high
	 * ground, because the camera flies at floor + terrain. Denver needs 3,000 m
	 * for the Front Range and the Himalayas need it for obvious reasons; a
	 * coastal city does not.
	 */
	static readonly CATALOG: readonly Location[] = [
		new Location('hyderabad', 'Hyderabad, India', 17.4435, 78.3772, 'Asia/Kolkata', 500, 400, 13_000),
		new Location('mumbai', 'Mumbai, India', 19.076, 72.8777, 'Asia/Kolkata', 10, 400, 13_000),
		new Location('dubai', 'Dubai, UAE', 25.2048, 55.2708, 'Asia/Dubai', 5, 400, 13_000),
		new Location('dallas', 'Dallas, Texas', 32.7767, -96.797, 'America/Chicago', 150, 600, 13_000),
		new Location('phoenix', 'Phoenix, Arizona', 33.4352, -112.0101, 'America/Phoenix', 340, 700, 13_000),
		new Location('las_vegas', 'Las Vegas, Nevada', 36.1699, -115.1398, 'America/Los_Angeles', 620, 900, 13_000),
		new Location('denver', 'Denver, Colorado', 39.8561, -104.6737, 'America/Denver', 1_600, 3_000, 13_000),
		new Location('chicago_midway', 'Chicago Midway', 41.7868, -87.7522, 'America/Chicago', 190, 600, 13_000),
		new Location('himalayas', 'The Himalayas', 27.9881, 86.925, 'Asia/Kathmandu', 5_000, 3_000, 13_000),
		new Location('ocean', 'Pacific Ocean', 21.3069, -157.8583, 'Pacific/Honolulu', 0, 400, 13_000),
		new Location('desert', 'Sahara Desert', 23.4241, 25.6628, 'Africa/Cairo', 500, 500, 13_000),
		new Location('clouds', 'Above Tokyo', 35.6762, 139.6503, 'Asia/Tokyo', 40, 1_000, 13_000)
	];

	/** The fielded kiosk home, and the fallback for anything unrecognised. */
	static hyderabad(): Location {
		return Location.CATALOG[0];
	}

	static denver(): Location {
		return Location.byId('denver');
	}

	static byId(id: string | null | undefined): Location {
		return Location.CATALOG.find((l) => l.id === id) ?? Location.hyderabad();
	}

	static all(): readonly Location[] {
		return Location.CATALOG;
	}
}
