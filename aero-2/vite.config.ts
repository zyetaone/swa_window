import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { normalizePath } from 'vite';
import path from 'node:path';
import { execSync } from 'node:child_process';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesiumStatic';

// Build-time commit stamp — surfaced fleet-wide via /api/status so an operator
// can tell WHICH commit each Pi is running. APP_COMMIT env is the no-.git
// escape hatch (tarball builds); 'unknown' the last resort.
function gitCommit(): string {
	try {
		return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return 'unknown';
	}
}

// Under `vitest`, resolve Svelte's BROWSER entry so components can actually be
// MOUNTED in tests. With the default (SSR) condition, `mount()` throws
// lifecycle_function_unavailable, so component behaviour could only be reasoned
// about, never executed — which is how a blank-page bug once reached production
// with a fully green suite. Scoped to the test run so the kiosk build is
// untouched.
const IS_TEST = process.env.VITEST !== undefined;

export default defineConfig({
	...(IS_TEST ? { resolve: { conditions: ['browser'] } } : {}),
	plugins: [
		tailwindcss(),
		viteStaticCopy({
			targets: [
				{ src: normalizePath(path.join(cesiumSource, 'ThirdParty')), dest: cesiumBaseUrl },
				{ src: normalizePath(path.join(cesiumSource, 'Workers')), dest: cesiumBaseUrl },
				{ src: normalizePath(path.join(cesiumSource, 'Assets')), dest: cesiumBaseUrl },
				{ src: normalizePath(path.join(cesiumSource, 'Widgets')), dest: cesiumBaseUrl },
			],
		}),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be
				// removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				// `await` at component top level, in $derived, and in markup.
				// Used for the pending-state boundaries around imagery/tile loads.
				experimental: { async: true },
			},

			// adapter-node, NOT adapter-auto: the Pi kiosk serves its own routes —
			// the SSE fleet bus, mDNS peer discovery, and the tile/bundle endpoints
			// all need a long-lived Node server. `bun run serve` is the literal
			// ExecStart of aero-app.service.
			adapter: adapter(),
			experimental: { remoteFunctions: true },

			// No `alias` block: SvelteKit 3 deprecates config.alias, and $lib
			// no longer resolves at all. Both $lib and $content are replaced by
			// package.json subpath imports (#lib/*, #content/*), which is the
			// sanctioned Kit 3 mechanism. Note these require explicit .js
			// extensions — `#lib/foo` fails, `#lib/foo.js` resolves.
			csp: {
				directives: {
					'default-src': ['self'],
					'script-src': ['self', 'unsafe-eval'], // Cesium protobufjs needs eval
					'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
					'img-src': [
						'self', 'data:', 'blob:',
						'https://*.arcgis.com', 'https://*.arcgisonline.com',
						'https://*.cesium.com', 'https://assets.ion.cesium.com',
						'https://*.bing.com',
						'https://*.googleapis.com', 'https://*.gstatic.com',
						'https://*.cartocdn.com',
						'https://*.tile.openstreetmap.org',
						'https://gibs.earthdata.nasa.gov',
						'https://tiles.maps.eox.at',
						'https://media.githubusercontent.com',
					],
					'connect-src': [
						'self',
						// ws:/wss: are NOT dev-only here — this csp block is not
						// dev-conditional, and Vite HMR needs them. Do not remove.
						'ws:', 'wss:', 'http:', 'https:',
						'https://*.arcgis.com', 'https://*.arcgisonline.com',
						'https://*.cesium.com', 'https://api.cesium.com', 'https://assets.ion.cesium.com',
						'https://*.bing.com',
						'https://*.googleapis.com',
						'https://*.cartocdn.com',
						'https://*.tile.openstreetmap.org',
						'https://gibs.earthdata.nasa.gov',
						'https://tiles.maps.eox.at',
						'https://tiles.openfreemap.org',
						'https://*.openfreemap.org',
					],
					'worker-src': ['self', 'blob:'], // Cesium web workers
					'child-src': ['blob:'],
					'font-src': ['self', 'https://fonts.gstatic.com'],
				},
			},
		}),
	],
	server: {
		// Bind to 0.0.0.0 for LAN/kiosk access (Raspberry Pi deployment).
		host: true,
	},
	define: {
		CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
		__APP_COMMIT__: JSON.stringify(process.env.APP_COMMIT ?? gitCommit()),
	},
	build: {
		chunkSizeWarningLimit: 5000,
		rollupOptions: {
			output: {
				manualChunks(id: string): string | undefined {
					if (id.includes('node_modules/three') || id.includes('node_modules/@threlte')) {
						return 'three';
					}
					if (id.includes('node_modules/cesium')) {
						return 'cesium';
					}
					return undefined;
				},
			},
		},
	},
	test: {
		environment: 'happy-dom',
		include: ['tests/**/*.{test,spec}.{ts,svelte.ts}'],
		globals: false,
	},
});
