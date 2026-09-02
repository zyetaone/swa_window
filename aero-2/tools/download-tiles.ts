#!/usr/bin/env bun
/**
 * Download-tiles — pre-fetch one layer for a bounding box into data/tiles/,
 * the layout server/tiles.ts already serves (WMTS: {layer}/{z}/{y}/{x}.{ext}).
 * Reuses remoteTileUrl so the upstream host stays named in exactly one file.
 *
 * A radius covering a whole city is only affordable at a modest zoom — every
 * level roughly quadruples the tile count. Run this twice: once broad at a
 * low-mid zoom for the flight corridor, once tight (a few km) at a high zoom
 * for a specific point of interest (an airport, say).
 *
 * Usage:
 *   bun tools/download-tiles.ts <layer> <lat> <lon> <radiusKm> <minZoom> <maxZoom>
 *   bun tools/download-tiles.ts esri 17.385 78.4867 40 10 16          # city corridor
 *   bun tools/download-tiles.ts esri 17.2403 78.4294 6 17 19          # RGIA airport patch
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { remoteTileUrl } from '../src/lib/server/tiles.js';

const [layer, latStr, lonStr, radiusKmStr, minZoomStr, maxZoomStr] = process.argv.slice(2);
if (!layer || !latStr) {
	console.error(
		'Usage: bun tools/download-tiles.ts <layer> <lat> <lon> <radiusKm> <minZoom> <maxZoom>'
	);
	process.exit(1);
}
const lat = Number(latStr);
const lon = Number(lonStr);
const radiusKm = Number(radiusKmStr);
const minZoom = Number(minZoomStr);
const maxZoom = Number(maxZoomStr);
/**
 * The extension is part of the LAYER, not a default with one exception.
 *
 * This read `layer === 'terrarium' ? 'png' : 'jpg'`, so `viirs` — which is
 * PNG, because city lights need an alpha channel over the base imagery — was
 * fetched and written as `.jpg`. The upstream request still succeeded (GIBS
 * ignores the extension), so the tool reported hundreds downloaded and zero
 * failed while writing files at paths the server never looks up. The kiosk
 * 404'd on every one of them and the packager said it was done.
 *
 * Keyed off the layer explicitly so a new layer has to declare its own format
 * rather than inherit a guess.
 */
const LAYER_EXT = { gibs: 'jpg', viirs: 'png', terrarium: 'png' } as const;
const ext = LAYER_EXT[layer as keyof typeof LAYER_EXT];
if (!ext) {
	console.error(
		`unknown layer '${layer}' — add it to LAYER_EXT. Known: ${Object.keys(LAYER_EXT).join(', ')}`
	);
	process.exit(1);
}
const TILE_DIR = process.env.TILE_DIR ?? 'data/tiles';
const CONCURRENCY = 6;

function lonToX(lonDeg: number, z: number): number {
	return Math.floor(((lonDeg + 180) / 360) * 2 ** z);
}
function latToY(latDeg: number, z: number): number {
	const rad = (latDeg * Math.PI) / 180;
	return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

interface Job {
	z: number;
	x: number;
	y: number;
}

function planJobs(): Job[] {
	const dLat = radiusKm / 111;
	const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
	const jobs: Job[] = [];
	for (let z = minZoom; z <= maxZoom; z++) {
		const xMin = lonToX(lon - dLon, z);
		const xMax = lonToX(lon + dLon, z);
		const yMin = latToY(lat + dLat, z); // north = smaller y
		const yMax = latToY(lat - dLat, z);
		for (let x = xMin; x <= xMax; x++) {
			for (let y = yMin; y <= yMax; y++) {
				jobs.push({ z, x, y });
			}
		}
	}
	return jobs;
}

interface FetchResult {
	status: 'ok' | 'skip' | 'fail';
	bytes?: number;
}

/**
 * A bare `fetch` here has no timeout, so one hung connection parks a worker for
 * good: with CONCURRENCY workers, a few stalls collapse throughput to nothing
 * while still looking like it is "running". Measured: 171 tiles in ten minutes
 * against ~8/second when healthy. Bound the wait and retry instead.
 */
const TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;

async function fetchTile(job: Job): Promise<FetchResult> {
	const filePath = `${TILE_DIR}/${layer}/${job.z}/${job.y}/${job.x}.${ext}`;
	if (existsSync(filePath)) return { status: 'skip' };

	const url = remoteTileUrl(`${layer}/${job.z}/${job.y}/${job.x}.${ext}`);
	if (!url) return { status: 'fail' };

	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
			// 404 means no coverage there — retrying cannot help, and it is not an error.
			if (res.status === 404) return { status: 'skip' };
			if (!res.ok) continue;
			const buf = new Uint8Array(await res.arrayBuffer());
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, buf);
			return { status: 'ok', bytes: buf.byteLength };
		} catch {
			// timeout or transport error: fall through and retry
		}
	}
	return { status: 'fail' };
}

async function main() {
	const jobs = planJobs();
	console.log(
		`${layer}: ${jobs.length} tiles, z${minZoom}-${maxZoom}, r=${radiusKm}km around ${lat},${lon}`
	);

	let ok = 0;
	let skip = 0;
	let fail = 0;
	let i = 0;
	const bytesByZoom = new Map<number, { sum: number; count: number }>();

	async function worker() {
		while (i < jobs.length) {
			const job = jobs[i++];
			const result = await fetchTile(job);
			if (result.status === 'ok') {
				ok++;
				if (result.bytes !== undefined) {
					const stat = bytesByZoom.get(job.z) ?? { sum: 0, count: 0 };
					stat.sum += result.bytes;
					stat.count++;
					bytesByZoom.set(job.z, stat);
				}
			} else if (result.status === 'skip') skip++;
			else fail++;
			if ((ok + skip + fail) % 200 === 0) {
				console.log(`  ${ok + skip + fail}/${jobs.length} (ok=${ok} skip=${skip} fail=${fail})`);
			}
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	console.log(`done: ${ok} downloaded, ${skip} skipped (existing/no coverage), ${fail} failed`);

	// A placeholder "no imagery at this LOD" tile compresses far smaller than
	// real satellite detail — a cliff in avg size marks the real usable ceiling,
	// not whatever maxzoom was requested.
	if (bytesByZoom.size > 1) {
		console.log('avg tile size by zoom (a cliff here = past real coverage, cap maxzoom below it):');
		for (const z of [...bytesByZoom.keys()].sort((a, b) => a - b)) {
			const { sum, count } = bytesByZoom.get(z)!;
			console.log(`  z${z}: ${(sum / count / 1024).toFixed(1)} KB avg (n=${count})`);
		}
	}
}

main();
