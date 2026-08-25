/**
 * Location catalog and lookup for fielded kiosks and simulation targets.
 */

export class Location {
	constructor(
		readonly id: string,
		readonly name: string,
		readonly lat: number,
		readonly lon: number,
		readonly timeZone: string,
		readonly utcOffset: number,
		/** Mean terrain height, metres MSL. */
		readonly groundElevationM: number,
		/** Climb envelope, metres ABOVE GROUND. Floor must clear local peaks. */
		readonly climbFloorM: number,
		readonly climbCeilingM: number
	) {}

	static hyderabad(): Location {
		return new Location(
			'hyderabad',
			'Hyderabad, India',
			17.385,
			78.4867,
			'Asia/Kolkata',
			5.5,
			500,
			400,
			13_000
		);
	}

	static denver(): Location {
		return new Location(
			'denver',
			'Denver, Colorado',
			39.7392,
			-104.9903,
			'America/Denver',
			-7,
			1_600,
			3_000,
			13_000
		);
	}

	static byId(id: string | null | undefined): Location {
		return id === 'denver' ? Location.denver() : Location.hyderabad();
	}

	static all(): readonly Location[] {
		return [Location.hyderabad(), Location.denver()];
	}
}
