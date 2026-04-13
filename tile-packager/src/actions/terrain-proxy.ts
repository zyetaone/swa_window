/**
 * Terrain Recording Proxy
 *
 * Intercepts Cesium Ion terrain requests, forwards them to Ion,
 * and saves the responses to disk in the same directory structure
 * that CesiumTerrainProvider expects.
 *
 * Usage:
 *   1. Start the proxy: bun run terrain-proxy.ts --token <ION_TOKEN> --output ./tiles/terrain
 *   2. Point CesiumJS at the proxy instead of Ion
 *   3. Fly through all locations to record terrain tiles
 *   4. Package the recorded tiles for offline serving
 *
 * The proxy creates a layer.json at the root that CesiumTerrainProvider can read.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DEFAULT_ION_TERRAIN_URL = 'https://assets.ion.cesium.com/1';
const PROXY_PORT = 8877;

interface ProxyConfig {
	ionToken: string;
	outputDir: string;
	ionTerrainUrl?: string;
}

/**
 * Start the terrain recording proxy server.
 * Returns a cleanup function to stop the server.
 */
export async function startTerrainProxy(config: ProxyConfig): Promise<{ stop: () => void; port: number }> {
	const { ionToken, outputDir, ionTerrainUrl = DEFAULT_ION_TERRAIN_URL } = config;
	let recordedTiles = 0;
	let recordedBytes = 0;
	const availableTiles: Map<number, Set<string>> = new Map(); // z -> set of "x/y"

	// Ensure output dir
	await mkdir(outputDir, { recursive: true });

	const server = Bun.serve({
		port: PROXY_PORT,
		async fetch(req) {
			const url = new URL(req.url);

			// Health
			if (url.pathname === '/health') {
				return Response.json({
					status: 'ok',
					recordedTiles,
					recordedBytes,
					mode: 'terrain-proxy',
				});
			}

			// layer.json passthrough (needed by CesiumTerrainProvider)
			if (url.pathname === '/layer.json') {
				const cached = join(outputDir, 'layer.json');
				if (existsSync(cached)) {
					return new Response(Bun.file(cached), {
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				// Fetch from Ion and cache
				const ionUrl = `${ionTerrainUrl}/layer.json`;
				const resp = await fetch(ionUrl, {
					headers: { Authorization: `Bearer ${ionToken}` },
				});
				if (resp.ok) {
					const body = await resp.text();
					await writeFile(cached, body);
					return new Response(body, {
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
						},
					});
				}
				return new Response('layer.json not available', { status: 502 });
			}

			// Terrain tile: /{z}/{x}/{y}.terrain
			const match = url.pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.terrain$/);
			if (match) {
				const [, zStr, xStr, yStr] = match;
				const z = parseInt(zStr);
				const x = parseInt(xStr);
				const y = parseInt(yStr);

				const tilePath = join(outputDir, String(z), String(x), `${y}.terrain`);

				// Serve from cache if exists
				if (existsSync(tilePath)) {
					return new Response(Bun.file(tilePath), {
						headers: {
							'Content-Type': 'application/vnd.quantized-mesh',
							'Content-Encoding': 'gzip',
							'Access-Control-Allow-Origin': '*',
							'Access-Control-Expose-Headers': 'Content-Encoding',
						},
					});
				}

				// Fetch from Ion
				const ionUrl = `${ionTerrainUrl}/${z}/${x}/${y}.terrain`;
				try {
					const resp = await fetch(ionUrl, {
						headers: {
							Authorization: `Bearer ${ionToken}`,
							'Accept-Encoding': 'gzip',
							Accept: 'application/vnd.quantized-mesh,application/octet-stream;q=0.9',
						},
					});

					if (!resp.ok) {
						return new Response('Terrain tile not found', {
							status: resp.status,
							headers: { 'Access-Control-Allow-Origin': '*' },
						});
					}

					// Save to disk
					const data = await resp.arrayBuffer();
					await mkdir(dirname(tilePath), { recursive: true });
					await Bun.write(tilePath, data);

					recordedTiles++;
					recordedBytes += data.byteLength;

					// Track availability
					if (!availableTiles.has(z)) availableTiles.set(z, new Set());
					availableTiles.get(z)!.add(`${x}/${y}`);

					// Periodically update layer.json with availability
					if (recordedTiles % 100 === 0) {
						await updateLayerJson(outputDir, availableTiles);
						console.log(`[terrain-proxy] Recorded ${recordedTiles} tiles (${(recordedBytes / 1024 / 1024).toFixed(1)} MB)`);
					}

					return new Response(data, {
						headers: {
							'Content-Type': 'application/vnd.quantized-mesh',
							'Content-Encoding': 'gzip',
							'Access-Control-Allow-Origin': '*',
							'Access-Control-Expose-Headers': 'Content-Encoding',
						},
					});
				} catch (e) {
					console.warn(`[terrain-proxy] Failed to fetch ${z}/${x}/${y}:`, e);
					return new Response('Proxy error', { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
				}
			}

			// CORS preflight
			if (req.method === 'OPTIONS') {
				return new Response(null, {
					status: 204,
					headers: {
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'GET, OPTIONS',
						'Access-Control-Allow-Headers': '*',
					},
				});
			}

			return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
		},
	});

	console.log(`[terrain-proxy] Recording terrain to ${outputDir} on http://localhost:${PROXY_PORT}`);
	console.log(`[terrain-proxy] Point CesiumTerrainProvider at http://localhost:${PROXY_PORT}`);

	return {
		stop: () => server.stop(),
		port: PROXY_PORT,
	};
}

/**
 * Update the locally-served layer.json with actual tile availability.
 */
async function updateLayerJson(outputDir: string, available: Map<number, Set<string>>): Promise<void> {
	const layerJsonPath = join(outputDir, 'layer.json');
	let layerJson: Record<string, unknown> = {};

	if (existsSync(layerJsonPath)) {
		try {
			layerJson = JSON.parse(await readFile(layerJsonPath, 'utf-8'));
		} catch { /* use empty */ }
	}

	// Build availability array — Cesium uses this to know which tiles exist
	const maxZoom = Math.max(...available.keys(), 0);
	const availableArr: Array<Array<{ startX: number; startY: number; endX: number; endY: number }>> = [];

	for (let z = 0; z <= maxZoom; z++) {
		const tiles = available.get(z);
		if (!tiles || tiles.size === 0) {
			availableArr.push([]);
			continue;
		}
		// Simple: report the bounding range of available tiles
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (const key of tiles) {
			const [xs, ys] = key.split('/');
			const tx = parseInt(xs);
			const ty = parseInt(ys);
			minX = Math.min(minX, tx);
			maxX = Math.max(maxX, tx);
			minY = Math.min(minY, ty);
			maxY = Math.max(maxY, ty);
		}
		availableArr.push([{ startX: minX, startY: minY, endX: maxX, endY: maxY }]);
	}

	layerJson.available = availableArr;
	layerJson.format = 'quantized-mesh-1.0';
	layerJson.version = '1.2.0';
	layerJson.scheme = 'tms';

	await writeFile(layerJsonPath, JSON.stringify(layerJson, null, 2));
}
