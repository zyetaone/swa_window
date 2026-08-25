import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Cesium's runtime assets are copied into static/ by scripts/sync-cesium.mjs
const cesiumBaseUrl = 'cesiumStatic';

// Under `vitest`, resolve Svelte's BROWSER entry so components can be mounted in tests.
const IS_TEST = process.env.VITEST !== undefined;

export default defineConfig({
	...(IS_TEST ? { resolve: { conditions: ['browser'] } } : {}),
	plugins: [
		sveltekit({
			adapter: adapter(),
			csp: {
				directives: {
					'default-src': ['self'],
					'script-src': ['self', 'unsafe-eval'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': [
						'self',
						'data:',
						'blob:',
						'https://*.arcgis.com',
						'https://*.arcgisonline.com',
						'https://*.cesium.com',
						'https://assets.ion.cesium.com',
						'https://*.bing.com',
					],
					'connect-src': [
						'self',
						'ws:',
						'wss:',
						'http:',
						'https:',
						'https://*.arcgis.com',
						'https://*.arcgisonline.com',
						'https://*.cesium.com',
						'https://api.cesium.com',
						'https://assets.ion.cesium.com',
						'https://*.bing.com',
					],
					'worker-src': ['self', 'blob:'],
					'child-src': ['blob:'],
					'font-src': ['self'],
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
	},
	build: {
		chunkSizeWarningLimit: 5000,
		rollupOptions: {
			output: {
				manualChunks(id: string): string | undefined {
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
