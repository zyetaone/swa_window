import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
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
					'ws://localhost:*', 'http://localhost:*',
					'ws://127.0.0.1:*', 'http://127.0.0.1:*',
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
