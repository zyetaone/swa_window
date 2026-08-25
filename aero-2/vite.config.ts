import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Under `vitest`, resolve Svelte's BROWSER entry so components can be mounted in tests.
const IS_TEST = process.env.VITEST !== undefined;

export default defineConfig({
	...(IS_TEST ? { resolve: { conditions: ['browser'] } } : {}),
	plugins: [
		sveltekit({
			adapter: adapter(),
			csp: {
				directives: {
					// GIBS, USGS and terrarium are all fetched server-side, through
					// /api/tiles — the browser never talks to any of those hosts
					// directly, so img-src/connect-src need nothing beyond self.
					'default-src': ['self'],
					'script-src': ['self', 'unsafe-eval'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'connect-src': ['self', 'ws:', 'wss:'],
					'worker-src': ['self', 'blob:'],
					'child-src': ['blob:'],
					'font-src': ['self']
				}
			}
		})
	],
	// maplibre-gl ships its worker as a separate chunk that the dep optimizer
	// repeatedly loses ("maplibre-gl-worker.mjs does not exist"). Without the
	// worker the map builds a canvas but never fetches a raster tile — a blank
	// map with no error in the page. Prebundling it buys nothing here.
	optimizeDeps: {
		exclude: ['maplibre-gl']
	},
	server: {
		// Bind to 0.0.0.0 for LAN/kiosk access (Raspberry Pi deployment).
		host: true
	},
	build: {
		chunkSizeWarningLimit: 2000
	},
	test: {
		environment: 'happy-dom',
		include: ['tests/**/*.{test,spec}.{ts,svelte.ts}'],
		setupFiles: ['tests/setup.ts'],
		globals: false
	}
});
