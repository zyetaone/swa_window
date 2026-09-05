import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { normalizePath } from 'vite';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';


/**
 * Resolved, not a hardcoded `node_modules/...` path.
 *
 * Bun hoists dependencies to the workspace root, so since v1 moved into
 * `aero-1/` the package no longer sits under this directory and a literal
 * relative path silently found nothing. vite-plugin-static-copy then failed
 * the build with "No file was found to copy" — and the failure mode when it
 * does NOT fail the build is worse: a kiosk that boots to a black canvas
 * because Cesium's Workers and Assets were never emitted.
 *
 * `require.resolve` asks node where the package actually is, which is correct
 * whether it is hoisted, nested, linked, or vendored.
 */
const cesiumSource = path.join(
	path.dirname(createRequire(import.meta.url).resolve('cesium/package.json')),
	'Build/Cesium'
);
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

// Under `vitest`, resolve Svelte's BROWSER entry so components can actually be
// MOUNTED in tests. With the default (SSR) condition, `mount()` throws
// lifecycle_function_unavailable, so component behaviour could only be reasoned
// about, never executed — which is how a blank-page context bug reached
// production with a fully green suite. Scoped to the test run by an env check so
// the kiosk/adapter-node build is untouched.
const IS_TEST = process.env.VITEST !== undefined;

export default defineConfig({
	...(IS_TEST ? { resolve: { conditions: ['browser'] } } : {}),
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
		// With route-split client output, optional vendor splits keep Threlte
		// off the critical path once ThreeOverlay is dynamically imported.
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
		/**
		 * 5s is not enough for the exhaustive sweeps. `roads-geojson`'s flicker
		 * check walks 18 phases x 2400 steps and asserts twice per step —
		 * ~86k `expect` calls, which is the cost, not the maths. It passes in
		 * isolation and times out when the suite shares a CPU with a build,
		 * which on a loaded CI runner flakes the branch `promote` gates on.
		 */
		testTimeout: 30_000,
	},
});
