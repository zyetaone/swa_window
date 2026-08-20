#!/usr/bin/env bun
/**
 * Aero Window — VIIRS × roads composite baker
 *
 * Bakes a combined night layer: each cartodb-dark road tile's RGB is
 * multiplied by the luminance of the VIIRS night-lights cover over the same
 * geo footprint, so street networks bloom only where VIIRS says there is a
 * real lit area. A floor (default 0.15) keeps a minimum of road glow in
 * sparse-but-real towns — see glowFactor() in viirs-roads-math.ts.
 *
 * Runtime note: the app keys transparency with colorToAlpha. CartoDB uses
 * threshold 0.12 (near-black basemap); the composite path uses ~0.03 so this
 * floor is not keyed out. Keep floor and roadCompositeThreshold in dialogue
 * (src/lib/world/imagery.ts COLOR_TO_ALPHA).
 *
 * Reads the existing packager cache, writes a NEW layer alongside it:
 *
 *   input:  <tiles>/cartodb-dark/{z}/{x}/{y}@2x.png      (untouched)
 *           <tiles>/viirs-night-lights/{z}/{y}/{x}.jpg   (untouched)
 *   output: <tiles>/viirs-roads/{z}/{x}/{y}@2x.png       (new layer)
 *
 * Output mirrors the cartodb-dark on-disk layout exactly, so the runtime
 * serves it via the existing /api/tiles passthrough with zero server
 * changes — the app just points a second UrlTemplateImageryProvider at
 * {tileBase}/viirs-roads/{z}/{x}/{y}@2x.png (z4–12, 512×512 PNG).
 *
 * Missing VIIRS cover (cache gap) is treated as black → roads fall back to
 * the floor glow, counted and reported at the end.
 *
 * Usage:
 *   bun src/viirs-roads.ts                          # composite the whole cache
 *   bun src/viirs-roads.ts -- --input ./data/tiles  # custom tile dir
 *   bun src/viirs-roads.ts -- --floor 0.2           # raise minimum road glow
 *   bun src/viirs-roads.ts -- --force               # overwrite existing output
 *   bun src/viirs-roads.ts -- --concurrency 6       # parallel sharp pipelines
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import sharp from 'sharp';
import {
	VIIRS_Z,
	VIIRS_PX,
	ROAD_PX,
	viirsCoverForRoadTile,
	modulateRoadPixels,
} from './viirs-roads-math';

// ─── CLI ────────────────────────────────────────────────────────────────────

interface Args {
	input: string;
	floor: number;
	force: boolean;
	concurrency: number;
	limit: number;
}

function parseArgs(): Args {
	const a = process.argv.slice(2);
	const out: Args = { input: './data/tiles', floor: 0.15, force: false, concurrency: 6, limit: 0 };
	for (let i = 0; i < a.length; i++) {
		switch (a[i]) {
			case '--input':       out.input = a[++i]; break;
			case '--floor':       out.floor = Number(a[++i]); break;
			case '--force':       out.force = true; break;
			case '--concurrency': out.concurrency = Number(a[++i]) || 6; break;
			case '--limit':       out.limit = Number(a[++i]) || 0; break;
			case '-h':
			case '--help':
				console.log(`Usage:
  bun src/viirs-roads.ts                      Composite cartodb-dark × viirs-night-lights → viirs-roads
  bun src/viirs-roads.ts -- --input DIR       Tile cache root (default ./data/tiles)
  bun src/viirs-roads.ts -- --floor 0.15      Minimum road glow where VIIRS is dark (0–1)
  bun src/viirs-roads.ts -- --force           Re-bake tiles that already have output
  bun src/viirs-roads.ts -- --concurrency 6   Parallel tiles (default 6)
  bun src/viirs-roads.ts -- --limit 20        Bake only the first N tiles (smoke test)
`);
				process.exit(0);
		}
	}
	if (!(out.floor >= 0 && out.floor < 1)) {
		console.error(`--floor must be in [0, 1), got ${out.floor}`);
		process.exit(1);
	}
	return out;
}

// ─── Cache walking ──────────────────────────────────────────────────────────

interface RoadTile {
	z: number;
	x: number;
	y: number;
	path: string;
}

/** Enumerate cartodb-dark/{z}/{x}/{y}@2x.png from the cache. */
async function enumerateRoadTiles(cartodbDir: string): Promise<RoadTile[]> {
	const tiles: RoadTile[] = [];
	for (const zDir of await readdir(cartodbDir)) {
		const z = Number(zDir);
		if (!Number.isInteger(z)) continue;
		const zPath = join(cartodbDir, zDir);
		for (const xDir of await readdir(zPath)) {
			const x = Number(xDir);
			if (!Number.isInteger(x)) continue;
			const xPath = join(zPath, xDir);
			for (const file of await readdir(xPath)) {
				const m = file.match(/^(\d+)@2x\.png$/);
				if (!m) continue;
				tiles.push({ z, x, y: Number(m[1]), path: join(xPath, file) });
			}
		}
	}
	return tiles;
}

// ─── Composite ──────────────────────────────────────────────────────────────

interface CompositeResult {
	missingViirs: number;
}

/**
 * Bake one road tile: render the VIIRS z8 cover onto the road tile's pixel
 * grid, multiply road RGB by per-pixel glow factor, write PNG.
 */
async function compositeTile(
	tile: RoadTile,
	viirsDir: string,
	outPath: string,
	floor: number,
): Promise<CompositeResult> {
	const pieces = viirsCoverForRoadTile(tile.z, tile.x, tile.y);

	// Render each covering VIIRS tile piece into its dest rect on the road grid.
	const composites: sharp.OverlayOptions[] = [];
	let missingViirs = 0;
	for (const p of pieces) {
		// Packager storagePath: viirs-night-lights/{z}/{y}/{x}.jpg
		const viirsPath = join(viirsDir, String(VIIRS_Z), String(p.vy), `${p.vx}.jpg`);
		if (!existsSync(viirsPath)) {
			missingViirs++;
			continue; // background stays black → floor glow
		}
		const piece = await sharp(viirsPath)
			.extract(p.extract)
			.resize(p.dest.width, p.dest.height, { kernel: 'lanczos3' })
			.png()
			.toBuffer();
		composites.push({ input: piece, left: p.dest.left, top: p.dest.top });
	}

	const viirs = await sharp({
		create: {
			width: ROAD_PX,
			height: ROAD_PX,
			channels: 3,
			background: { r: 0, g: 0, b: 0 },
		},
	})
		.composite(composites)
		// PNG overlays carry alpha, which would promote the composite canvas to
		// RGBA — modulateRoadPixels reads a packed RGB buffer, so drop it.
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	if (viirs.info.channels !== 3) {
		throw new Error(`VIIRS cover has ${viirs.info.channels} channels, expected 3`);
	}
	const viirsRaw = new Uint8Array(viirs.data.buffer, viirs.data.byteOffset, viirs.data.byteLength);

	const road = await sharp(tile.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	if (road.info.width !== ROAD_PX || road.info.height !== ROAD_PX) {
		throw new Error(`unexpected road tile size ${road.info.width}x${road.info.height}`);
	}

	const roadRaw = new Uint8Array(road.data.buffer, road.data.byteOffset, road.data.byteLength);
	modulateRoadPixels(roadRaw, viirsRaw, ROAD_PX * ROAD_PX, floor);

	await mkdir(dirname(outPath), { recursive: true });
	await sharp(roadRaw, {
		raw: { width: ROAD_PX, height: ROAD_PX, channels: 4 },
	})
		// Palette PNG: cartodb source tiles are 4-bit colormaps, and modulation
		// can't create new hues — ≤16 distinct colours per tile, so 256-colour
		// palette output is lossless here and ~30% smaller than RGBA.
		.png({ palette: true, dither: 0 })
		.toFile(outPath);

	return { missingViirs };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
	const args = parseArgs();
	const cartodbDir = join(args.input, 'cartodb-dark');
	const viirsDir = join(args.input, 'viirs-night-lights');
	const outDir = join(args.input, 'viirs-roads');

	if (!existsSync(cartodbDir)) {
		console.error(`No cartodb-dark cache at ${cartodbDir} — run the tile packager first.`);
		process.exit(1);
	}
	if (!existsSync(viirsDir)) {
		console.error(`No viirs-night-lights cache at ${viirsDir} — run the tile packager first.`);
		process.exit(1);
	}

	const tiles = await enumerateRoadTiles(cartodbDir);
	const targets = tiles.slice(0, args.limit > 0 ? args.limit : tiles.length);
	console.log(`🛣  Road tiles:   ${tiles.length} (cartodb-dark z${Math.min(...tiles.map((t) => t.z))}–z${Math.max(...tiles.map((t) => t.z))})${args.limit > 0 ? ` — baking first ${targets.length} (--limit)` : ''}`);
	console.log(`🌃 VIIRS source: z${VIIRS_Z} ${VIIRS_PX}px luminance cover`);
	console.log(`🔆 Floor:        ${args.floor} (roads never darker than ${Math.round(args.floor * 100)}% of source)`);
	console.log(`📂 Output:       ${outDir}`);
	console.log();

	let done = 0;
	let baked = 0;
	let skipped = 0;
	let failed = 0;
	let totalMissingViirs = 0;
	const startMs = Date.now();

	const queue = targets.slice();
	const workers = Array.from({ length: args.concurrency }, async () => {
		while (queue.length) {
			const tile = queue.shift();
			if (!tile) break;
			done++;
			// Output mirrors the cartodb layout: viirs-roads/{z}/{x}/{y}@2x.png
			const outPath = join(outDir, String(tile.z), String(tile.x), `${tile.y}@2x.png`);
			if (existsSync(outPath) && !args.force) {
				skipped++;
				continue;
			}
			try {
				const { missingViirs } = await compositeTile(tile, viirsDir, outPath, args.floor);
				totalMissingViirs += missingViirs;
				baked++;
			} catch (e) {
				console.warn(`\n  ✗ z${tile.z}/${tile.x}/${tile.y}: ${(e as Error).message}`);
				failed++;
			}
			if (done % 100 === 0) {
				const pct = ((done / targets.length) * 100).toFixed(1);
				const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
				process.stdout.write(`\r  ${done}/${targets.length} (${pct}%) — baked ${baked} skipped ${skipped} failed ${failed} — ${elapsed}s   `);
			}
		}
	});
	await Promise.all(workers);

	console.log('\n');
	console.log(`✅ ${baked} baked, ${skipped} skipped (existing), ${failed} failed`);
	if (totalMissingViirs > 0) {
		console.log(`⚠️  ${totalMissingViirs} VIIRS cover piece(s) missing from cache — those areas baked at floor glow. Re-run the packager for viirs-night-lights to fill gaps, then re-run with --force.`);
	}
	console.log(`⏱  ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
	console.error('FATAL:', e);
	process.exit(1);
});
