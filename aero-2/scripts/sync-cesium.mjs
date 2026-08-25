/**
 * Copy Cesium's runtime assets into static/ so SvelteKit serves them at
 * /cesiumStatic in both dev and build.
 *
 * This replaces vite-plugin-static-copy, whose output silently vanished under
 * Vite 8 + SvelteKit 3: it logged "Copied 4 items" while nothing appeared in
 * .svelte-kit/output/client, so the production server answered 404 for every
 * Cesium worker. static/ is a platform feature with no plugin to disagree with
 * the build, and one copy covers dev and prod alike.
 */
import { cp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = 'node_modules/cesium/Build/Cesium';
const DEST = 'static/cesiumStatic';
const DIRS = ['ThirdParty', 'Workers', 'Assets', 'Widgets'];

try {
	await stat(SRC);
} catch {
	console.error(`[sync-cesium] ${SRC} missing — run install first`);
	process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
for (const dir of DIRS) {
	await cp(join(SRC, dir), join(DEST, dir), { recursive: true });
}
console.log(`[sync-cesium] copied ${DIRS.join(', ')} -> ${DEST}`);
