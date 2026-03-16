/**
 * @zyeta/tile-server — Minimal Bun static file server for offline tiles
 *
 * Serves pre-downloaded tile packages from the local filesystem.
 * Designed to run on Pi 5 as a systemd service alongside Chromium kiosk.
 *
 * Routes:
 *   GET /health              → { status: 'ok', tileDir, locations[] }
 *   GET /manifest.json       → tile manifest (what's cached, sizes)
 *   GET /{layer}/{z}/{x}/{y} → tile file (CORS, immutable cache)
 *   GET /terrain/layer.json  → terrain metadata (for CesiumTerrainProvider)
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TILE_DIR = process.env.TILE_DIR || '/opt/zyeta-aero/tiles';
const PORT = parseInt(process.env.TILE_PORT || '8888', 10);

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

const MIME_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.terrain': 'application/vnd.quantized-mesh',
	'.json': 'application/json',
};

function getMimeType(path: string): string {
	const ext = path.substring(path.lastIndexOf('.'));
	return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/** List cached locations by scanning the imagery directory */
function getCachedLocations(): string[] {
	const imageryDir = join(TILE_DIR, 'imagery');
	if (!existsSync(imageryDir)) return [];
	try {
		return readdirSync(imageryDir);
	} catch {
		return [];
	}
}

/** Get total disk usage of tile directory */
function getDiskUsage(): number {
	let total = 0;
	function walk(dir: string): void {
		try {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else total += statSync(full).size;
			}
		} catch { /* skip unreadable dirs */ }
	}
	walk(TILE_DIR);
	return total;
}

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		// CORS preflight
		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// Health endpoint
		if (url.pathname === '/health') {
			return Response.json({
				status: 'ok',
				tileDir: TILE_DIR,
				diskUsageBytes: getDiskUsage(),
			}, { headers: CORS_HEADERS });
		}

		// Manifest
		if (url.pathname === '/manifest.json') {
			const manifestPath = join(TILE_DIR, 'manifest.json');
			const file = Bun.file(manifestPath);
			if (await file.exists()) {
				return new Response(file, {
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}
			return Response.json({ error: 'No manifest found' }, { status: 404, headers: CORS_HEADERS });
		}

		// Terrain layer.json (special: CesiumTerrainProvider needs this)
		if (url.pathname === '/terrain/layer.json') {
			const layerJsonPath = join(TILE_DIR, 'terrain', 'layer.json');
			const file = Bun.file(layerJsonPath);
			if (await file.exists()) {
				return new Response(file, {
					headers: {
						...CORS_HEADERS,
						'Content-Type': 'application/json',
						'Cache-Control': 'public, max-age=86400',
					},
				});
			}
			// Generate a basic layer.json if terrain tiles exist but no layer.json
			return Response.json({
				tilejson: '2.1.0',
				format: 'quantized-mesh-1.0',
				version: '1.0.0',
				scheme: 'tms',
				tiles: [`http://localhost:${PORT}/terrain/{z}/{x}/{y}.terrain`],
				available: [],
			}, { headers: CORS_HEADERS });
		}

		// Static tile files
		// URL pattern: /{layer}/{z}/{x}/{y}.{ext}
		const filePath = join(TILE_DIR, url.pathname);

		// Security: prevent path traversal
		if (!filePath.startsWith(TILE_DIR)) {
			return new Response('Forbidden', { status: 403 });
		}

		const file = Bun.file(filePath);
		if (await file.exists()) {
			return new Response(file, {
				headers: {
					...CORS_HEADERS,
					'Content-Type': getMimeType(filePath),
					'Cache-Control': 'public, max-age=31536000, immutable',
				},
			});
		}

		return new Response('Not found', { status: 404, headers: CORS_HEADERS });
	},
});

console.log(`[tile-server] Serving tiles from ${TILE_DIR} on http://localhost:${PORT}`);
