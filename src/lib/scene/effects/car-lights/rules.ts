/**
 * Car-lights — pure procedural seeding rules.
 *
 * Jugaad MVP: no real road data. Seed N dots in a radial cluster around a
 * center point, biased toward the middle (quadratic distribution) so the
 * density falls off naturally. Each dot gets a stable random value used to
 * pick its class (white headlight / red taillight / blue emergency flicker).
 */

export interface LightSeed {
	lat: number;
	lon: number;
	/** Per-dot random value in [0,1) — determines color class. */
	rand: number;
}

export type LightClass = 'white' | 'red' | 'blue';

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
 * 70% warm white (headlights), 25% warm red (taillights), 5% blue (emergency).
 */
export function lightClass(rand: number): LightClass {
	if (rand < 0.70) return 'white';
	if (rand < 0.95) return 'red';
	return 'blue';
}

/** RGBA byte tuple for a given class — consumed by the effect component. */
export function lightColorBytes(cls: LightClass): [number, number, number, number] {
	switch (cls) {
		case 'white': return [255, 230, 200, 220];
		case 'red':   return [255, 60, 40, 200];
		case 'blue':  return [120, 160, 255, 230];
	}
}
