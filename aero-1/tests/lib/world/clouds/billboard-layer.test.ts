/**
 * clouds/billboard-layer lifecycle — mount-race liveness.
 *
 * Same race as lightning-stage: CesiumViewer.onDestroy can fire while
 * CesiumManager.start() is suspended in an await, so destroy() runs first
 * and start() then resumes calling mountCesiumClouds on a destroyed viewer.
 * A bare `if (_mounted) return` guard would latch the dead viewer's
 * collection and silently disable Cesium clouds for the rest of the session.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type * as CesiumType from 'cesium';
import {
	mountCesiumClouds,
	updateCesiumClouds,
	destroyCesiumClouds,
} from '$lib/world/clouds/billboard-layer';
import { createSeededRng, daySeed } from '$lib/world/prng';
import { spriteOffset, spriteScale } from '$lib/world/clouds/sprite-placement';

interface FakeBillboard {
	position: { lon: number; lat: number; alt: number };
}

function fakeCesium() {
	return {
		BillboardCollection: class {
			billboards: FakeBillboard[] = [];
			add(b: FakeBillboard) { this.billboards.push(b); return b; }
			removeAll() { this.billboards = []; }
			get length() { return this.billboards.length; }
		},
		// Capture the exact geographic coords the layer computed — the test
		// inverts metresToGeoDelta on these to recover worldX / worldZ.
		Cartesian3: {
			fromDegrees: (lon: number, lat: number, alt: number) => ({ lon, lat, alt }),
		},
		Color: class {
			constructor(
				public r: number, public g: number, public b: number, public a: number,
			) {}
		},
		NearFarScalar: class {
			constructor(
				public near: number, public nearValue: number,
				public far: number, public farValue: number,
			) {}
		},
	} as unknown as typeof CesiumType;
}

interface FakeViewer {
	destroyed: boolean;
	primitives: unknown[];
	isDestroyed(): boolean;
	scene: {
		primitives: {
			add(p: unknown): unknown;
			remove(p: unknown): void;
		};
	};
}

function fakeViewer(): FakeViewer {
	const primitives: unknown[] = [];
	return {
		destroyed: false,
		primitives,
		scene: {
			primitives: {
				add: (p) => { primitives.push(p); return p; },
				remove: (p) => { primitives.splice(primitives.indexOf(p), 1); },
			},
		},
		isDestroyed() { return this.destroyed; },
	};
}

describe('mountCesiumClouds liveness', () => {
	afterEach(() => destroyCesiumClouds());

	it('is idempotent on a live viewer', () => {
		const v = fakeViewer();
		mountCesiumClouds(fakeCesium(), v as unknown as CesiumType.Viewer);
		mountCesiumClouds(fakeCesium(), v as unknown as CesiumType.Viewer);
		expect(v.primitives).toHaveLength(1);
	});

	it('does not latch a collection when start() resumes on a destroyed viewer', () => {
		const v1 = fakeViewer();
		mountCesiumClouds(fakeCesium(), v1 as unknown as CesiumType.Viewer);
		expect(v1.primitives).toHaveLength(1);

		// onDestroy fires while start() is suspended: destroy() runs first.
		v1.destroyed = true;
		destroyCesiumClouds();

		// start() resumes and calls mountCesiumClouds on the destroyed viewer.
		mountCesiumClouds(fakeCesium(), v1 as unknown as CesiumType.Viewer);
		expect(v1.primitives).toHaveLength(1); // nothing new added

		// The next LIVE mount must succeed — the race must not bar it.
		const v2 = fakeViewer();
		mountCesiumClouds(fakeCesium(), v2 as unknown as CesiumType.Viewer);
		expect(v2.primitives).toHaveLength(1);
	});

	it('remounts when the latched collection belongs to a destroyed viewer', () => {
		const v1 = fakeViewer();
		mountCesiumClouds(fakeCesium(), v1 as unknown as CesiumType.Viewer);
		v1.destroyed = true; // viewer died without destroyCesiumClouds

		const v2 = fakeViewer();
		mountCesiumClouds(fakeCesium(), v2 as unknown as CesiumType.Viewer);
		expect(v2.primitives).toHaveLength(1);
	});
});

/**
 * worldZ raw-oz pin.
 *
 * The placement contract (clouds/sprite-placement.ts header) is that BOTH
 * cloud renderers put each sprite at the SAME (ox, oy, oz): the Three
 * overlay does `sprite.position.set(ox, oy, oz)` verbatim, so the Cesium
 * billboard layer must use raw `oz` too. An earlier build mirrored Z
 * around the cluster centre (`worldZ = cz - (oz - cz)`), flipping every
 * off-centre sprite to the opposite side of its cluster. These tests
 * replay the exact seeded generation sequence and assert each captured
 * billboard position recovers to raw ox / oz — the mirrored form fails.
 *
 * The band constants below mirror the module-private values in
 * clouds/billboard-layer.ts ON PURPOSE: a band retune must be deliberate
 * enough to update this pin.
 */
const M_PER_DEG_LAT = 111_320; // matches clouds/sprite-placement.ts

const BANDS = [
	{ countMin: 60, countSpan: 50, rMin: 42_000, rSpan: 265_000 - 42_000, chSpan: 4600, baseMin: 18_000, baseSpan: 32_000 - 18_000, spriteMin: 9, spriteSpan: 8, lonely: 0.03 },
	{ countMin: 24, countSpan: 16, rMin: 1_500, rSpan: 30_000 - 1_500, chSpan: 1400, baseMin: 3_000, baseSpan: 6_000 - 3_000, spriteMin: 4, spriteSpan: 7, lonely: 0.10 },
];

interface ExpectedSprite { ox: number; oz: number; cz: number }

/** Replay updateCesiumClouds' rng draws, collecting (ox, oz) per billboard. */
function expectedPlacement(density: number): ExpectedSprite[] {
	const rng = createSeededRng(daySeed());
	const out: ExpectedSprite[] = [];
	for (const b of BANDS) {
		const count = Math.round(b.countMin + Math.min(1, density) * b.countSpan);
		for (let c = 0; c < count; c++) {
			const theta = rng() * Math.PI * 2;
			const r = b.rMin + Math.sqrt(rng()) * b.rSpan;
			const cx = Math.cos(theta) * r;
			const cz = -Math.sin(theta) * r;
			const ch = (rng() - 0.18) * b.chSpan;

			const baseScale = b.baseMin + rng() * b.baseSpan;
			const isLonely = rng() < b.lonely;
			const spriteCount = isLonely ? 1 : b.spriteMin + Math.floor(rng() * b.spriteSpan);

			for (let i = 0; i < spriteCount; i++) {
				const { ox, oz } = spriteOffset(i, cx, ch, cz, baseScale, rng);
				if (i !== 0) { rng(); rng(); } // brightness + opacity draws (non-anchor)
				spriteScale(i, baseScale, rng);
				rng(); // texture pick
				out.push({ ox, oz, cz });
			}
		}
	}
	return out;
}

describe('updateCesiumClouds placement', () => {
	afterEach(() => destroyCesiumClouds());

	it('places every sprite at raw ox / oz in both bands (no cz-mirror)', () => {
		const v = fakeViewer();
		mountCesiumClouds(fakeCesium(), v as unknown as CesiumType.Viewer);
		const lat = 36.17, lon = -115.14, density = 0.5;
		updateCesiumClouds(lat, lon, 'cloudy', density, 35_000, true);

		const collection = v.primitives[0] as { billboards: FakeBillboard[] };
		const billboards = collection.billboards;
		const expected = expectedPlacement(density);
		expect(billboards).toHaveLength(expected.length);

		const cosLat = Math.cos((lat * Math.PI) / 180);
		let offCentre = 0;
		for (let k = 0; k < expected.length; k++) {
			const pos = billboards[k].position;
			const worldX = (pos.lon - lon) * M_PER_DEG_LAT * cosLat;
			const worldZ = (pos.lat - lat) * M_PER_DEG_LAT;
			expect(worldX).toBeCloseTo(expected[k].ox, 6);
			// THE pin: raw oz. The mirrored form `cz - (oz - cz)` lands the
			// sprite on the opposite side of the cluster centre and fails here.
			expect(worldZ).toBeCloseTo(expected[k].oz, 6);
			if (Math.abs(expected[k].oz - expected[k].cz) > 1) offCentre++;
		}
		// Discriminator: the deck must contain plenty of OFF-CENTRE sprites,
		// otherwise the raw-oz assertion above could not tell `oz` apart
		// from the mirrored `2·cz − oz` (identical at the anchor, oz === cz).
		expect(offCentre).toBeGreaterThan(500);
	});

	it('is deterministic across mounts — same day, same deck (invariant #4)', () => {
		const lat = 36.17, lon = -115.14, density = 0.5;

		const v1 = fakeViewer();
		mountCesiumClouds(fakeCesium(), v1 as unknown as CesiumType.Viewer);
		updateCesiumClouds(lat, lon, 'cloudy', density, 35_000, true);
		const first = (v1.primitives[0] as { billboards: FakeBillboard[] }).billboards
			.map((b) => b.position);
		destroyCesiumClouds();

		const v2 = fakeViewer();
		mountCesiumClouds(fakeCesium(), v2 as unknown as CesiumType.Viewer);
		updateCesiumClouds(lat, lon, 'cloudy', density, 35_000, true);
		const second = (v2.primitives[0] as { billboards: FakeBillboard[] }).billboards
			.map((b) => b.position);

		expect(second).toEqual(first);
	});
});
