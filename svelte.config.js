import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter(),
		// Pi 5 kiosk: single JS bundle reduces concurrent connections
		// and speeds up cold start in Chromium kiosk mode.
		// Ref: https://svelte.dev/docs/kit/project-types#Embedded-device
		output: {
			bundleStrategy: 'single',
		},
		csp: {
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'unsafe-eval'],       // Cesium protobufjs needs eval
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
				],
				'connect-src': [
					'self',
					'https://*.arcgis.com', 'https://*.arcgisonline.com',
					'https://*.cesium.com', 'https://api.cesium.com', 'https://assets.ion.cesium.com',
					'https://*.bing.com',
					'https://*.googleapis.com',
					'https://*.cartocdn.com',
					'https://*.tile.openstreetmap.org',
					'https://gibs.earthdata.nasa.gov',
				],
				'worker-src': ['self', 'blob:'],              // Cesium web workers
				'child-src': ['blob:'],
				'font-src': ['self', 'https://fonts.gstatic.com'],
			},
		},
	}
};

export default config;
