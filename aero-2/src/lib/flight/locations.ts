/**
 * The worlds we fly over. Add one here and it is flyable — no other edit.
 */

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
