import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
	plugins: [tailwindcss(), cesium(), sveltekit()],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					// Split large vendor libraries for better caching
					if (id.includes('node_modules')) {
						// Three.js core library
						if (id.includes('three/build') || id.includes('three/src')) {
							return 'three';
						}
						// Threlte wrapper libraries
						if (id.includes('@threlte')) {
							return 'threlte';
						}
						// Cesium library
						if (id.includes('cesium')) {
							return 'cesium';
						}
						// UI/Control libraries
						if (id.includes('tweakpane') || id.includes('lucide-svelte')) {
							return 'ui-libs';
						}
					}
				}
			}
		},
		// Increase chunk size warning limit - Three.js and Cesium are large
		chunkSizeWarningLimit: 1500
	}
});
