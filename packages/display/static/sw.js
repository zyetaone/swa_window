/**
 * Service Worker — Cesium tile caching for offline/low-latency kiosk operation
 *
 * Strategy: Cache-first for terrain/imagery tiles, network-first for everything else.
 * After first viewing, all Cesium tiles load from cache — dramatically reduces
 * network latency on Pi 5 after initial boot.
 */

const CACHE_NAME = 'aero-tiles-v1';
const TILE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// URL patterns that match Cesium tile requests
const TILE_PATTERNS = [
	/assets\.ion\.cesium\.com/,
	/\.arcgis\.com/,
	/\.arcgisonline\.com/,
	/gibs\.earthdata\.nasa\.gov/,
	/basemaps\.cartocdn\.com/,
	/tile\.openstreetmap\.org/,
	/khms\d*\.googleapis\.com/,
	/\/tiles\//,
];

function isTileRequest(url) {
	return TILE_PATTERNS.some(pattern => pattern.test(url));
}

// Install: pre-cache nothing — tiles are cached on first use
self.addEventListener('install', (event) => {
	self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(names =>
			Promise.all(
				names
					.filter(name => name !== CACHE_NAME)
					.map(name => caches.delete(name))
			)
		).then(() => self.clients.claim())
	);
});

// Fetch: cache-first for tiles, network-first for everything else
self.addEventListener('fetch', (event) => {
	const { request } = event;

	// Only cache GET requests
	if (request.method !== 'GET') return;

	// Tile requests: cache-first
	if (isTileRequest(request.url)) {
		event.respondWith(
			caches.open(CACHE_NAME).then(async (cache) => {
				const cached = await cache.match(request);
				if (cached) return cached;

				try {
					const response = await fetch(request);
					if (response.ok) {
						// Clone and cache the response
						cache.put(request, response.clone());
					}
					return response;
				} catch {
					// Offline: return 503 for tiles we don't have cached
					return new Response('Offline', { status: 503 });
				}
			})
		);
		return;
	}

	// Everything else: network-first (SvelteKit pages, JS, CSS)
});

// Periodic cache cleanup: remove entries older than TILE_MAX_AGE
async function cleanExpiredTiles() {
	const cache = await caches.open(CACHE_NAME);
	const keys = await cache.keys();
	const now = Date.now();

	for (const request of keys) {
		const response = await cache.match(request);
		if (!response) continue;
		const dateHeader = response.headers.get('date');
		if (dateHeader) {
			const age = now - new Date(dateHeader).getTime();
			if (age > TILE_MAX_AGE) {
				await cache.delete(request);
			}
		}
	}
}

// Run cleanup once per day
self.addEventListener('message', (event) => {
	if (event.data === 'cleanup') {
		cleanExpiredTiles();
	}
});
