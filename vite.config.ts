import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { normalizePath } from 'vite';
import path from 'node:path';
import { execSync } from 'node:child_process';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesiumStatic';

// Build-time commit stamp — surfaced fleet-wide via /api/status so an
// operator can tell WHICH commit each Pi is running (staged-rollout +
// remote-debugging prerequisite). APP_COMMIT env is the no-.git escape
// hatch (tarball builds); 'unknown' the last resort.
function gitCommit(): string {
	try {
		return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return 'unknown';
	}
}

export default defineConfig({
	plugins: [
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
	server: {
		// Bind to 0.0.0.0 for LAN/kiosk access (Raspberry Pi deployment).
		// In untrusted network environments, remove `host: true` or restrict
		// with an allowedHosts list: https://vite.dev/config/server-options#server-allowedhosts
		host: true,
	},
	define: {
		CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
		__APP_COMMIT__: JSON.stringify(process.env.APP_COMMIT ?? gitCommit()),
	},
	build: {
		// manualChunks removed — incompatible with bundleStrategy:'single'
		// in svelte.config.js (which enables inlineDynamicImports).
		// Single-bundle mode already handles Cesium bundling.
		chunkSizeWarningLimit: 5000,
	},
	test: {
		environment: 'happy-dom',
		include: ['tests/**/*.{test,spec}.{ts,svelte.ts}'],
		globals: false,
	},
});
