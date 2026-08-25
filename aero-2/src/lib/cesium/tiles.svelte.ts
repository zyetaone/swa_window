/**
 * What the local tile pack actually holds. Probed once at open().
 */

const TILE_SERVER_DEFAULT = '/api/tiles';

export function tileServerBase(): string {
	const url = import.meta.env.VITE_TILE_SERVER_URL;
	return typeof url === 'string' && url.length > 0 ? url.replace(/\/$/, '') : TILE_SERVER_DEFAULT;
}

export class TileCache {
	layers = $state<string[]>([]);
	probing = $state(false);

	hasTiles = $derived(this.layers.length > 0);

	layerAvailable(layerId: string): boolean {
		return this.layers.includes(layerId);
	}

	async probe(): Promise<void> {
		this.probing = true;
		const base = tileServerBase();
		try {
			const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
			if (!resp.ok) {
				this.layers = [];
				return;
			}
			const body = (await resp.json().catch(() => null)) as {
				hasTiles?: boolean;
				layers?: unknown;
			} | null;
			const found = Array.isArray(body?.layers)
				? body.layers.filter((l): l is string => typeof l === 'string')
				: [];
			this.layers = body?.hasTiles === false ? [] : found;
		} catch {
			this.layers = [];
		} finally {
			this.probing = false;
		}
	}

	reset(): void {
		this.layers = [];
		this.probing = false;
	}
}

export const tileCache = new TileCache();
