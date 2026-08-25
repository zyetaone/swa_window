/**
 * Where `/api/tiles` actually is. A plain function, not a rune: this is read
 * once per tile-template construction, not watched.
 */

const TILE_SERVER_DEFAULT = '/api/tiles';

export function tileServerBase(): string {
	const url = import.meta.env.VITE_TILE_SERVER_URL;
	return typeof url === 'string' && url.length > 0 ? url.replace(/\/$/, '') : TILE_SERVER_DEFAULT;
}
