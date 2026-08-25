/**
 * The worlds we fly over. Add one here and it is flyable — no other edit.
 *
 * `groundElevationM` is why this is not just lat/lon: the atmosphere bands are
 * about height ABOVE GROUND, not above the sea. 10 km over Denver and 10 km
 * over Mumbai are different views, and only the first has rock in the way.
 */

export class Location {
	constructor(
		readonly id: string,
		readonly lat: number,
		readonly lon: number,
		readonly timeZone: string,
		readonly utcOffset: number,
		/** Mean terrain height, metres MSL. */
		readonly groundElevationM: number,
		/** Climb envelope, metres ABOVE GROUND. Floor must clear the local peaks. */
		readonly climbFloorM: number,
		readonly climbCeilingM: number
	) {}

	static hyderabad(): Location {
		// Deccan plateau — gently undulating, nothing to fly into.
		return new Location('hyderabad', 17.385, 78.4867, 'Asia/Kolkata', 5.5, 500, 400, 13_000);
	}

	static denver(): Location {
		// Front Range: city at 1 600 m, peaks to ~4 300 m within 60 km. The floor
		// is 3 000 m AGL so the camera clears the mountains rather than through them.
		return new Location('denver', 39.7392, -104.9903, 'America/Denver', -7, 1_600, 3_000, 13_000);
	}

	static byId(id: string | null | undefined): Location {
		return id === 'denver' ? Location.denver() : Location.hyderabad();
	}
}
