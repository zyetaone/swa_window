/**
 * Car-lights — pure procedural seeding rules.
 *
 * Jugaad MVP: no real road data. Seed N dots in a radial cluster around a
 * center point, biased toward the middle (quadratic distribution) so the
 * density falls off naturally. Each dot gets a stable random value used to
 * pick its class (white headlight / red taillight / warm-yellow accent).
 *
 * The RGBA palette for each class lives in $content/palettes/car-lights —
 * edit there, not here.
 */

import { CAR_LIGHTS_PALETTE, type LightClass } from '$content/palettes';

export type { LightClass };

export interface LightSeed {
	lat: number;
	lon: number;
	/** Per-dot random value in [0,1) — determines color class. */
	rand: number;
}

/**
 * Generate `count` point seeds in a radial cluster around (centerLat, centerLon).
 * `radiusDeg` is the outer radius in degrees (~0.08 ≈ 9 km at equator).
 * Distribution is quadratic-biased toward the center — cities are denser downtown.
 */
export function seedDots(
	centerLat: number,
	centerLon: number,
	count: number,
	radiusDeg: number,
	rand: () => number = Math.random,
): LightSeed[] {
	const seeds: LightSeed[] = [];
	for (let i = 0; i < count; i++) {
		// Quadratic radial bias: Math.pow(u, 1.5) concentrates samples near center
		const r = Math.pow(rand(), 1.5) * radiusDeg;
		const theta = rand() * Math.PI * 2;
		seeds.push({
			lat: centerLat + Math.cos(theta) * r,
			lon: centerLon + Math.sin(theta) * r,
			rand: rand(),
		});
	}
	return seeds;
}

/**
 * Classify a light by its rand value.
 * 70% white (headlights), 25% red (taillights), 5% accent (the 'blue' class
 * label is historical; the palette maps it to warm yellow).
 */
export function lightClass(rand: number): LightClass {
	if (rand < 0.70) return 'white';
	if (rand < 0.95) return 'red';
	return 'blue';
}

/** RGBA byte tuple for a given class — palette lookup. */
export function lightColorBytes(cls: LightClass): [number, number, number, number] {
	return CAR_LIGHTS_PALETTE[cls];
}
