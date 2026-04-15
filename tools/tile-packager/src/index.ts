#!/usr/bin/env bun
/**
 * Aero Window — Offline Tile Packager
 *
 * Pre-downloads tiles for every location in src/lib/locations.ts so the Pi
 * can serve them via /api/tiles/[...path] without internet access.
 *
 * Usage:
 *   bun run start                          # download all sources, all locations
 *   bun run start -- --estimate            # dry-run: show storage estimate only
 *   bun run start -- --output ./data/tiles # custom output dir
 *   bun run start -- --locations dubai,himalayas  # subset
 *   bun run start -- --sources eox-sentinel2,viirs-night-lights  # subset
 */

import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { LOCATIONS } from '../../../src/lib/locations';
import type { LocationId } from '../../../src/lib/locations';
import { enumerateTiles, estimateBytes, formatBytes, type TileSource } from './rules';
import { SOURCES, tileFilePath } from './sources';

// ─── CLI ────────────────────────────────────────────────────────────────────

interface Args {
	output: string;
	estimate: boolean;
	locations: LocationId[] | 'all';
	sources: TileSource[] | 'all';
	concurrency: number;
}

function parseArgs(): Args {
	const a = process.argv.slice(2);
	const out: Args = { output: './data/tiles', estimate: false, locations: 'all', sources: 'all', concurrency: 6 };
	for (let i = 0; i < a.length; i++) {
		switch (a[i]) {
			case '--output':      out.output = a[++i]; break;
			case '--estimate':    out.estimate = true; break;
			case '--locations':   out.locations = a[++i].split(',') as LocationId[]; break;
			case '--sources':     out.sources = a[++i].split(',') as TileSource[]; break;
			case '--concurrency': out.concurrency = Number(a[++i]) || 6; break;
			case '-h':
			case '--help':
				console.log(`Usage:
  bun run start                                Download all sources, all locations
  bun run start -- --estimate                  Dry-run: storage estimate only
  bun run start -- --output ./data/tiles       Custom output directory
  bun run start -- --locations dubai,himalayas Subset of locations
  bun run start -- --sources eox-sentinel2     Subset of sources (default: all)
  bun run start -- --concurrency 6             Parallel downloads (default 6)
`);
				process.exit(0);
		}
	}
	return out;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
	const args = parseArgs();
	const locations = args.locations === 'all'
		? LOCATIONS
		: LOCATIONS.filter((l) => (args.locations as LocationId[]).includes(l.id));

	const sources = args.sources === 'all'
		? Object.values(SOURCES)
		: Object.values(SOURCES).filter((s) => (args.sources as TileSource[]).includes(s.source));

	console.log(`📍 Locations:  ${locations.length} (${locations.map((l) => l.id).join(', ')})`);
	console.log(`🗺  Sources:    ${sources.length} (${sources.map((s) => s.source).join(', ')})`);
	console.log(`📂 Output:     ${args.output}`);
	console.log();

	// Plan: enumerate all (source, location, tile) triples upfront for accurate total.
	type Job = { url: string; path: string; bytes: number };
	const allJobs: Job[] = [];
	for (const loc of locations) {
		for (const cfg of sources) {
			const tiles = enumerateTiles(loc.lat, loc.lon, 0.5, cfg.zoomRange[0], cfg.zoomRange[1]);
			for (const t of tiles) {
				allJobs.push({
					url: cfg.urlForTile(t),
					path: join(args.output, tileFilePath(cfg, t)),
					bytes: estimateBytes(1, cfg.source),
				});
			}
		}
	}

	const totalEstimate = allJobs.reduce((sum, j) => sum + j.bytes, 0);
	console.log(`📊 ${allJobs.length} tiles ≈ ${formatBytes(totalEstimate)} estimated`);

	if (args.estimate) {
		console.log('(--estimate set, exiting before download)');
		return;
	}

	console.log(`⬇️  Downloading with concurrency ${args.concurrency}...\n`);

	// Skip already-downloaded tiles + parallel-fetch the rest.
	let done = 0;
	let downloaded = 0;
	let skipped = 0;
	let failed = 0;
	const startMs = Date.now();

	const queue = allJobs.slice();
	const workers = Array.from({ length: args.concurrency }, async () => {
		while (queue.length) {
			const job = queue.shift();
			if (!job) break;
			done++;
			if (existsSync(job.path)) {
				skipped++;
				continue;
			}
			try {
				await mkdir(dirname(job.path), { recursive: true });
				const res = await fetch(job.url);
				if (!res.ok) {
					failed++;
					continue;
				}
				const buf = new Uint8Array(await res.arrayBuffer());
				await Bun.write(job.path, buf);
				downloaded++;
			} catch {
				failed++;
			}
			if (done % 50 === 0) {
				const pct = ((done / allJobs.length) * 100).toFixed(1);
				const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
				process.stdout.write(`\r  ${done}/${allJobs.length} (${pct}%) — downloaded ${downloaded} skipped ${skipped} failed ${failed} — ${elapsed}s   `);
			}
		}
	});
	await Promise.all(workers);

	console.log('\n');
	console.log(`✅ Done: ${downloaded} downloaded, ${skipped} skipped (cached), ${failed} failed`);
	console.log(`⏱  ${((Date.now() - startMs) / 1000).toFixed(1)}s total`);
	console.log();
	console.log(`Next: set TILE_DIR=${args.output} on the Pi and add to .env:`);
	console.log(`  VITE_TILE_SERVER_URL=http://localhost:5173/api/tiles`);
	console.log('Then rebuild + restart aero-app. Cesium will fetch from local disk.');
}

main().catch((e) => {
	console.error('FATAL:', e);
	process.exit(1);
});
