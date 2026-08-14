import { describe, it, expect } from 'vitest';
import {
	VIIRS_Z,
	VIIRS_PX,
	ROAD_PX,
	viirsCoverForRoadTile,
	luma601,
	glowFactor,
	modulateRoadPixels,
} from '../../../tools/tile-packager/src/viirs-roads-math';

describe('viirsCoverForRoadTile', () => {
	it('maps a z8 road tile to exactly one aligned VIIRS tile, full-frame', () => {
		const pieces = viirsCoverForRoadTile(8, 100, 60);
		expect(pieces).toHaveLength(1);
		expect([pieces[0].vx, pieces[0].vy]).toEqual([100, 60]);
		expect(pieces[0].extract).toEqual({ left: 0, top: 0, width: VIIRS_PX, height: VIIRS_PX });
		expect(pieces[0].dest).toEqual({ left: 0, top: 0, width: ROAD_PX, height: ROAD_PX });
	});

	it('fans a z4 road tile out over a 16×16 VIIRS grid that partitions the road tile', () => {
		const pieces = viirsCoverForRoadTile(4, 6, 5);
		expect(pieces).toHaveLength(16 * 16);

		// dest rects must tile the full 512×512 road grid exactly once.
		const coverage = new Array(ROAD_PX * ROAD_PX).fill(0);
		for (const p of pieces) {
			expect(p.extract.width).toBe(VIIRS_PX);
			expect(p.extract.height).toBe(VIIRS_PX);
			for (let dy = 0; dy < p.dest.height; dy++) {
				for (let dx = 0; dx < p.dest.width; dx++) {
					coverage[(p.dest.top + dy) * ROAD_PX + p.dest.left + dx]++;
				}
			}
		}
		expect(coverage.every((c) => c === 1)).toBe(true);

		// Top-left VIIRS tile of the footprint: road tile (4,6,5) starts at
		// VIIRS px (6·512·8, 5·512·8) = tile (96, 80).
		expect(Math.min(...pieces.map((p) => p.vx))).toBe(96);
		expect(Math.min(...pieces.map((p) => p.vy))).toBe(80);
	});

	it('keeps a z12 road tile inside one VIIRS tile when not straddling a boundary', () => {
		// z12 tile (1600, 960): footprint in z8 px is 16 px at (16·x, 16·y) mod 256.
		// 16·1600 = 25600 = 100·256 + 0 → starts exactly at a VIIRS tile edge.
		const pieces = viirsCoverForRoadTile(12, 1600, 960);
		expect(pieces).toHaveLength(1);
		expect(pieces[0].extract).toEqual({ left: 0, top: 0, width: 16, height: 16 });
		expect(pieces[0].dest).toEqual({ left: 0, top: 0, width: ROAD_PX, height: ROAD_PX });
	});

	it('never straddles a VIIRS boundary below z8 (XYZ pyramids nest exactly)', () => {
		// z12 footprint is 16 VIIRS px, aligned to 16 — always inside one tile,
		// even when it ends exactly on a VIIRS tile edge (x ≡ 15 mod 16).
		for (const x of [1614, 1615, 1616]) {
			const pieces = viirsCoverForRoadTile(12, x, 975);
			expect(pieces).toHaveLength(1);
			expect(pieces[0].dest).toEqual({ left: 0, top: 0, width: ROAD_PX, height: ROAD_PX });
			expect(pieces[0].extract.width).toBe(16);
			expect(pieces[0].extract.height).toBe(16);
		}
		// x = 1615: footprint ends exactly at a VIIRS boundary → still one tile,
		// and the NEXT road tile picks up the neighbouring VIIRS tile.
		expect(viirsCoverForRoadTile(12, 1615, 975)[0].vx).toBe(100);
		expect(viirsCoverForRoadTile(12, 1616, 975)[0].vx).toBe(101);
	});

	it('drops VIIRS tiles outside the z8 world bounds instead of wrapping', () => {
		// z8 road tile at the antimeridian edge: x = 255 is the last valid tile.
		const pieces = viirsCoverForRoadTile(VIIRS_Z, 255, 0);
		expect(pieces.every((p) => p.vx < 2 ** VIIRS_Z && p.vy >= 0)).toBe(true);
	});
});

describe('luma601', () => {
	it('is black for black, white for white', () => {
		expect(luma601(0, 0, 0)).toBe(0);
		expect(luma601(255, 255, 255)).toBeCloseTo(255, 0);
	});
});

describe('glowFactor', () => {
	it('returns the floor for a fully dark VIIRS sample', () => {
		expect(glowFactor(0, 0.15)).toBeCloseTo(0.15);
	});

	it('returns 1 for a fully lit VIIRS sample', () => {
		expect(glowFactor(255, 0.15)).toBeCloseTo(1);
	});

	it('is monotonic in luminance and clamped to [floor, 1]', () => {
		let prev = -1;
		for (let lum = 0; lum <= 255; lum += 15) {
			const f = glowFactor(lum, 0.15);
			expect(f).toBeGreaterThan(prev);
			expect(f).toBeGreaterThanOrEqual(0.15);
			expect(f).toBeLessThanOrEqual(1);
			prev = f;
		}
	});
});

describe('modulateRoadPixels', () => {
	it('multiplies RGB by the glow factor and leaves alpha untouched', () => {
		// One road pixel at 50% grey, fully opaque; VIIRS fully black → floor.
		const road = new Uint8Array([100, 200, 50, 255]);
		const viirs = new Uint8Array([0, 0, 0]);
		modulateRoadPixels(road, viirs, 1, 0.2);
		expect(road[0]).toBe(20); // 100 · 0.2
		expect(road[1]).toBe(40); // 200 · 0.2
		expect(road[2]).toBe(10); // 50 · 0.2
		expect(road[3]).toBe(255); // alpha preserved
	});

	it('leaves road pixels unchanged over a fully lit VIIRS sample', () => {
		const road = new Uint8Array([100, 200, 50, 128]);
		const viirs = new Uint8Array([255, 255, 255]);
		modulateRoadPixels(road, viirs, 1, 0.15);
		expect([...road]).toEqual([100, 200, 50, 128]);
	});
});
