/**
 * TILE_DIR resolution — pure, testable, not a +server export.
 *
 * Anchor relative paths on process.cwd() (repo root in dev, deploy dir on Pi).
 * import.meta.url depth-counting breaks after bundling.
 *
 * Fallback: TILE_DIR env → /opt/zyeta-aero/tiles → ./data/tiles
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export function resolveTileDir(
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
	piDirExists: (path: string) => boolean = existsSync,
): string {
	if (env.TILE_DIR) return resolve(cwd, env.TILE_DIR);
	const piPath = '/opt/zyeta-aero/tiles';
	if (piDirExists(piPath)) return piPath;
	return resolve(cwd, 'data/tiles');
}
