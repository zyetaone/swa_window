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
					// GIBS and terrarium are fetched server-side, through /api/tiles —
					// the browser never talks to those hosts directly, so img-src and
					// connect-src need nothing beyond self.
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
	// `svelte-maplibre-gl/vite` is REQUIRED for MapLibre GL JS v6+ — it calls
	// setWorkerUrl with `import 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'`.
	// The file exists; what fails is the dep optimizer, which cannot resolve a
	// query-suffixed subpath through maplibre-gl's `exports` map and dies with
	// UNLOADABLE_DEPENDENCY. Excluding the package leaves that import to Vite's
	// own worker handling, which understands `?worker&url`.
	//
	// Without this the dev server either refuses to boot or, worse, boots and
	// silently renders a map that builds a canvas and never fetches a tile.
	optimizeDeps: {
		exclude: ['svelte-maplibre-gl', 'maplibre-gl']
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
