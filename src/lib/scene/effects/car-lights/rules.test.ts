import { describe, it, expect } from 'vitest';
import { seedDots, lightClass, lightColorBytes } from './rules';

describe('seedDots', () => {
	it('returns the requested number of seeds', () => {
		const seeds = seedDots(25.2, 55.3, 500, 0.1);
		expect(seeds).toHaveLength(500);
	});

	it('places every seed within the given radius', () => {
		const centerLat = 25.2;
		const centerLon = 55.3;
		const radius = 0.08;
		const seeds = seedDots(centerLat, centerLon, 1000, radius);
		for (const s of seeds) {
			const dLat = s.lat - centerLat;
			const dLon = s.lon - centerLon;
			const d = Math.sqrt(dLat * dLat + dLon * dLon);
			// Math.pow(u, 1.5) ≤ 1 for u in [0,1), so actual distance ≤ radius
			expect(d).toBeLessThanOrEqual(radius + 1e-9);
		}
	});

	it('gives each seed a rand value in [0, 1)', () => {
		const seeds = seedDots(0, 0, 200, 0.05);
		for (const s of seeds) {
			expect(s.rand).toBeGreaterThanOrEqual(0);
			expect(s.rand).toBeLessThan(1);
		}
	});

	it('is deterministic with a seeded rand function', () => {
		let x = 0.12345;
		const rng = () => {
			x = (x * 9301 + 49297) % 233280;
			return x / 233280;
		};
		const a = seedDots(0, 0, 50, 0.1, rng);
		x = 0.12345;
		const b = seedDots(0, 0, 50, 0.1, rng);
		expect(a).toEqual(b);
	});

	it('biases density toward the center (quadratic distribution)', () => {
		// Over many samples, the mean radius should be well below radius/2 (expected ≈ 2/5 * radius)
		const seeds = seedDots(0, 0, 5000, 1);
		const meanR = seeds.reduce((sum, s) => sum + Math.sqrt(s.lat * s.lat + s.lon * s.lon), 0) / seeds.length;
		expect(meanR).toBeLessThan(0.5);
	});
});

describe('lightClass', () => {
	it('classifies rand < 0.70 as white', () => {
		expect(lightClass(0)).toBe('white');
		expect(lightClass(0.35)).toBe('white');
		expect(lightClass(0.6999)).toBe('white');
	});

	it('classifies 0.70 <= rand < 0.95 as red', () => {
		expect(lightClass(0.70)).toBe('red');
		expect(lightClass(0.85)).toBe('red');
		expect(lightClass(0.9499)).toBe('red');
	});

	it('classifies rand >= 0.95 as blue', () => {
		expect(lightClass(0.95)).toBe('blue');
		expect(lightClass(0.99)).toBe('blue');
	});

	it('produces approximately 70/25/5 proportions over large sample', () => {
		const counts = { white: 0, red: 0, blue: 0 };
		const N = 10000;
		for (let i = 0; i < N; i++) {
			counts[lightClass(Math.random())]++;
		}
		// Allow 2% slack on each bucket
		expect(counts.white / N).toBeGreaterThan(0.68);
		expect(counts.white / N).toBeLessThan(0.72);
		expect(counts.red / N).toBeGreaterThan(0.23);
		expect(counts.red / N).toBeLessThan(0.27);
		expect(counts.blue / N).toBeGreaterThan(0.03);
		expect(counts.blue / N).toBeLessThan(0.07);
	});
});

describe('lightColorBytes', () => {
	it('returns 4 bytes for each class', () => {
		for (const cls of ['white', 'red', 'blue'] as const) {
			const [r, g, b, a] = lightColorBytes(cls);
			for (const v of [r, g, b, a]) {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(255);
			}
		}
	});

	it('white is warm (R > G > B)', () => {
		const [r, g, b] = lightColorBytes('white');
		expect(r).toBeGreaterThan(g);
		expect(g).toBeGreaterThan(b);
	});

	it('red dominates the red bucket', () => {
		const [r, g, b] = lightColorBytes('red');
		expect(r).toBeGreaterThan(g * 3);
		expect(r).toBeGreaterThan(b * 3);
	});

	it('blue dominates the blue bucket', () => {
		const [r, g, b] = lightColorBytes('blue');
		expect(b).toBeGreaterThan(r);
		expect(b).toBeGreaterThan(g);
	});
});
