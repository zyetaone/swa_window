/**
 * Tile Fetcher — rate-limited, resumable tile downloader
 *
 * Downloads tiles to a directory structure: {outputDir}/{layer}/{z}/{x}/{y}.{ext}
 * Supports resume (skips existing files), rate limiting, and progress callbacks.
 */

import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TileCoord, TileLayerConfig, ProgressCallback } from '../types';

/** Simple token-bucket rate limiter */
class RateLimiter {
	private tokens: number;
	private readonly maxTokens: number;
	private readonly refillRate: number; // tokens per ms
	private lastRefill: number;

	constructor(maxPerSecond: number) {
		this.maxTokens = maxPerSecond;
		this.tokens = maxPerSecond;
		this.refillRate = maxPerSecond / 1000;
		this.lastRefill = Date.now();
	}

	async acquire(): Promise<void> {
		while (true) {
			const now = Date.now();
			const elapsed = now - this.lastRefill;
			this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
			this.lastRefill = now;

			if (this.tokens >= 1) {
				this.tokens -= 1;
				return;
			}

			const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
			await new Promise(r => setTimeout(r, waitMs));
		}
	}
}

/** Build the download URL for a tile coordinate */
function buildTileUrl(template: string, tile: TileCoord): string {
	return template
		.replace('{z}', String(tile.z))
		.replace('{x}', String(tile.x))
		.replace('{y}', String(tile.y));
}

/** Get the local file path for a tile */
function tilePath(outputDir: string, layer: string, tile: TileCoord, ext: string): string {
	return join(outputDir, layer, String(tile.z), String(tile.x), `${tile.y}.${ext}`);
}

/**
 * Download all tiles for a layer within the given coordinate list.
 * Skips tiles that already exist on disk (resume support).
 */
export async function fetchTiles(
	config: TileLayerConfig,
	tiles: TileCoord[],
	outputDir: string,
	onProgress?: ProgressCallback,
	concurrency: number = 6,
): Promise<{ downloaded: number; skipped: number; failed: number; bytes: number }> {
	const limiter = new RateLimiter(config.rateLimit ?? 50);
	const ext = config.format === 'terrain' ? 'terrain' : config.format;

	let downloaded = 0;
	let skipped = 0;
	let failed = 0;
	let totalBytes = 0;

	// Process in batches for concurrency control
	const queue = [...tiles];
	const active: Promise<void>[] = [];

	async function processTile(tile: TileCoord): Promise<void> {
		const filePath = tilePath(outputDir, config.name, tile, ext);

		// Resume: skip existing files
		if (existsSync(filePath)) {
			skipped++;
			return;
		}

		await limiter.acquire();

		const url = buildTileUrl(config.urlTemplate, tile);
		try {
			const resp = await fetch(url, {
				headers: config.headers ?? {},
				signal: AbortSignal.timeout(15_000),
			});

			if (!resp.ok) {
				// 404 is expected for tiles outside coverage area
				if (resp.status === 404) {
					skipped++;
					return;
				}
				failed++;
				return;
			}

			const data = await resp.arrayBuffer();
			const dir = join(outputDir, config.name, String(tile.z), String(tile.x));
			await mkdir(dir, { recursive: true });
			await Bun.write(filePath, data);

			downloaded++;
			totalBytes += data.byteLength;
		} catch {
			failed++;
		}

		onProgress?.(config.name, downloaded + skipped, tiles.length);
	}

	// Concurrent download with a sliding window
	for (const tile of queue) {
		const p = processTile(tile).then(() => {
			active.splice(active.indexOf(p), 1);
		});
		active.push(p);

		if (active.length >= concurrency) {
			await Promise.race(active);
		}
	}

	await Promise.all(active);

	return { downloaded, skipped, failed, bytes: totalBytes };
}
