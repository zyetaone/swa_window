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
					if (id.includes('node_modules')) {
						if (id.includes('three/build') || id.includes('three/src')) {
							return 'three';
						}
						if (id.includes('@threlte')) {
							return 'threlte';
						}
						if (id.includes('cesium')) {
							return 'cesium';
						}
						if (id.includes('tweakpane') || id.includes('lucide-svelte')) {
							return 'ui-libs';
						}
					}
					return undefined;
				}
			}
		},
		chunkSizeWarningLimit: 1500
	}
});
