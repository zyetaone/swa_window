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
				'script-src': ['self', 'unsafe-eval'],       // Cesium protobufjs needs eval; SvelteKit auto-adds nonces for inline scripts
				'style-src': ['self', 'unsafe-inline'],       // Svelte component styles
				'img-src': ['self', 'data:', 'blob:', 'https://*.arcgis.com', 'https://*.arcgisonline.com', 'https://*.cesium.com', 'https://*.bing.com', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://basemaps.cartocdn.com', 'https://*.basemaps.cartocdn.com'],
				'connect-src': ['self', 'https://*.arcgis.com', 'https://*.arcgisonline.com', 'https://*.cesium.com', 'https://*.bing.com', 'https://*.googleapis.com', 'https://basemaps.cartocdn.com', 'https://*.basemaps.cartocdn.com', 'https://api.cesium.com'],
				'worker-src': ['self', 'blob:'],              // Cesium web workers
				'child-src': ['blob:'],                       // Cesium iframes
				'font-src': ['self'],
			},
		},
	}
};

export default config;
