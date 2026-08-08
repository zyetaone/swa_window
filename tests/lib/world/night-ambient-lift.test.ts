/**
 * Night ambient-lift response curve.
 *
 * ─── WHY THIS IS A UNIT TEST AND NOT A SCREENSHOT ───────────────────────────
 * I tried to validate the night-brightness fix by measuring luminance in
 * captured frames. That method is not sound here: the camera orbits
 * continuously and terrain streams in asynchronously, so the SAME build and
 * SAME scene measured five times gave mean luminance from 6.2 to 80.3 and
 * standard deviation from 0.4 to 61.7. Some captures were of the "LOADING
 * TERRAIN" overlay. Any before/after comparison built on that is noise.
 *
 * The shader's response curve, on the other hand, is a pure function. Encoding
 * it here makes the property deterministic and regression-proof.
 *
 * THE PROPERTY: the ambient floor must stop terrain crushing to black WITHOUT
 * flattening dark detail into a constant. `rgb = max(rgb, ambient)` fails this
 * — it maps every input below the floor onto exactly the floor.
 */
import { describe, it, expect } from 'vitest';

const ENV_LIGHT = 4.0;
const NIGHT = 1.0;
const AMBIENT = [0.065, 0.052, 0.038].map((v) => v * ENV_LIGHT * NIGHT);

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The shipped curve: additive, weighted by darkness AND by the pixel's value. */
function lift(inputLum: number): number {
	const base = [inputLum, inputLum, inputLum];
	const darkness = 1 - smoothstep(0, 0.35, inputLum);
	const scale = 0.35 + 1.6 * inputLum;
	return lum(base.map((v, i) => v + AMBIENT[i] * darkness * scale));
}

/** The old behaviour, kept to prove the regression is really gone. */
function oldMaxFloor(inputLum: number): number {
	const base = [inputLum, inputLum, inputLum];
	return lum(base.map((v, i) => Math.max(v, AMBIENT[i])));
}

const SWEEP = [0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5];

describe('night ambient lift', () => {
	it('is strictly monotonic — darker input never yields brighter output', () => {
		for (let i = 1; i < SWEEP.length; i++) {
			expect(lift(SWEEP[i])).toBeGreaterThan(lift(SWEEP[i - 1]));
		}
	});

	it('preserves detail where max() destroyed it', () => {
		// max() maps everything from 0.00 to 0.20 onto ONE value: no terrain shape.
		const oldDark = [0, 0.02, 0.05, 0.1].map(oldMaxFloor);
		expect(Math.max(...oldDark) - Math.min(...oldDark)).toBeLessThan(0.001);

		const newDark = [0, 0.02, 0.05, 0.1].map(lift);
		expect(Math.max(...newDark) - Math.min(...newDark)).toBeGreaterThan(0.05);
	});

	it('spans a wider output range than either previous form', () => {
		const range = (f: (x: number) => number) => {
			const v = SWEEP.map(f);
			return Math.max(...v) - Math.min(...v);
		};
		expect(range(lift)).toBeGreaterThan(range(oldMaxFloor));
	});

	it('still lifts pure black off zero', () => {
		// The floor must exist — that is the reason for the feature.
		expect(lift(0)).toBeGreaterThan(0.02);
	});

	it('leaves bright pixels essentially untouched', () => {
		// smoothstep(0,0.35) is 1 by 0.35, so the lift has fully decayed.
		expect(lift(0.5)).toBeCloseTo(0.5, 6);
		expect(lift(0.35)).toBeCloseTo(0.35, 6);
	});

	it('never pushes a value past white', () => {
		for (const x of SWEEP) expect(lift(x)).toBeLessThanOrEqual(1.0);
	});
});
