import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { normalizePath } from 'vite';
import path from 'node:path';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesiumStatic';

export default defineConfig({
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
		sveltekit(),
	],
	define: {
		CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('node_modules')) {
						if (id.includes('cesium')) {
							return 'cesium';
						}
					}
					return undefined;
				},
			},
		},
		chunkSizeWarningLimit: 5000,
	},
});
