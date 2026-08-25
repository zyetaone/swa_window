/**
 * Solar diurnal clock, local solar time, and day/night lighting curves.
 * Pure deterministic mathematics — rune-free and renderer-free.
 */

export function resolveLocalHours(wallSec: number, utcOffset: number): number {
	const utcSeconds = wallSec % 86_400;
	const localSeconds = (utcSeconds + utcOffset * 3600 + 86_400) % 86_400;
	return localSeconds / 3600;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/**
 * Night factor: 0.0 at solar noon (pure day) -> 1.0 at midnight (deep night).
 * Dusk transition: 18:00 - 20:30.
 * Dawn transition: 05:30 - 07:30.
 */
export function nightFactor(timeOfDay: number): number {
	const h = ((timeOfDay % 24) + 24) % 24;

	if (h >= 8 && h <= 17.5) return 0;
	if (h >= 21 || h <= 5) return 1;

	if (h > 17.5 && h < 21) {
		return smoothstep(17.5, 21, h);
	}

	return 1 - smoothstep(5, 8, h);
}
