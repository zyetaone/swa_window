import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Under `vitest`, resolve Svelte's BROWSER entry so components can be mounted in tests.
const IS_TEST = process.env.VITEST !== undefined;

/**
 * Extra origins the non-flight display modes may pull media from.
 *
 * Empty by default, and that is the intended fielded configuration: a kiosk
 * showing a client's own video wall should be serving those files from the Pi,
 * not from someone's CDN. But the CSP has to be able to say yes, because
 * `video`/`screensaver`/`playlist` mode is otherwise a feature that cannot work
 * with any URL an operator can actually type.
 *
 * It was silently broken until 2026-09-03: there was no `media-src` at all, so
 * remote video and audio fell back to `default-src 'self'` and were blocked,
 * and `img-src` had no room for a slideshow. All three modes rendered "Media
 * failed to load" — the shipped DEFAULT playlists pointed at
 * commondatastorage.googleapis.com, actions.google.com and images.unsplash.com,
 * so the feature was 100% broken out of the box and nothing said so. There is
 * no unit test that can see this; it is a header versus a <video> tag.
 *
 * Space-separated origins, build-time (CSP is emitted into the HTML shell), so
 * changing it needs a rebuild rather than a restart:
 *   AERO_MEDIA_ORIGINS="https://cdn.example.com https://media.example.org"
 */
const MEDIA_ORIGINS = (process.env.AERO_MEDIA_ORIGINS ?? '').split(/\s+/).filter(Boolean);

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
					// `blob:` covers the slideshow; MEDIA_ORIGINS covers a remote one.
					'img-src': ['self', 'data:', 'blob:', ...MEDIA_ORIGINS],
					// Declared even when empty. Without the directive `media-src` falls
					// back to `default-src`, and the failure is a silent block with no
					// error event on the element — which is how this shipped broken.
					'media-src': ['self', 'blob:', 'data:', ...MEDIA_ORIGINS],
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
