/**
 * Swaps the base texture and its zoom cap. Stateful: holds the layer it
 * last applied so an unchanged pick costs nothing.
 */
import type { GlobeRuntime, ImageryLayer, ImageryMode, Subsystem, RenderFrame } from '#lib/cesium/types.js';
import { IMAGERY_SOURCES } from '#lib/imagery/data.js';
import { gateImagerySelection, type ImagerySelection } from '#lib/imagery/rules.js';
import { tileCache, tileServerBase } from '#lib/cesium/tiles.svelte.js';

export class ImagerySync implements Subsystem {
	mode = $state<ImageryMode>('none');

	#layer: ImageryLayer | null = null;
	#applied: ImagerySelection | null = null;
	#ready = false;

	async setup(rt: GlobeRuntime): Promise<void> {
		rt.viewer.imageryLayers.removeAll();
		this.#layer = null;
		this.#applied = null;

		if (tileCache.hasTiles) {
			this.mode = 'local';
		} else if (rt.ionToken) {
			this.mode = 'ion';
			await this.#addIon(rt);
		} else {
			this.mode = 'none';
		}

		this.#ready = true;
	}

	sync(rt: GlobeRuntime, frame: RenderFrame): void {
		if (!this.#ready || this.mode !== 'local') return;

		const gated = gateImagerySelection(frame.imagery, (id) => tileCache.layerAvailable(id));
		if (sameImagery(this.#applied, gated)) return;

		if (this.#layer) {
			rt.viewer.imageryLayers.remove(this.#layer, true);
			this.#layer = null;
		}

		const source = IMAGERY_SOURCES.find((s) => s.id === gated.sourceId);
		const minimumLevel = source?.zoomRange[0] ?? 4;

		const provider = new rt.Cesium.UrlTemplateImageryProvider({
			url: this.#resolveUrl(gated.urlTemplate),
			maximumLevel: gated.maximumLevel,
			minimumLevel,
			tilingScheme: new rt.Cesium.WebMercatorTilingScheme(),
		});

		this.#layer = rt.viewer.imageryLayers.addImageryProvider(provider);
		this.#applied = gated;
	}

	reset(): void {
		this.#layer = null;
		this.#applied = null;
		this.#ready = false;
		this.mode = 'none';
	}

	async #addIon(rt: GlobeRuntime): Promise<void> {
		try {
			const provider = await rt.Cesium.IonImageryProvider.fromAssetId(2);
			this.#layer = rt.viewer.imageryLayers.addImageryProvider(provider);
		} catch (e) {
			console.warn('[ImagerySync] Ion fallback failed:', e);
			this.mode = 'none';
		}
	}

	#resolveUrl(template: string): string {
		const base = tileServerBase();
		if (template.startsWith('/api/tiles') && base !== '/api/tiles') {
			return template.replace('/api/tiles', base);
		}
		return template;
	}
}

function sameImagery(a: ImagerySelection | null, b: ImagerySelection): boolean {
	return (
		a !== null &&
		a.sourceId === b.sourceId &&
		a.urlTemplate === b.urlTemplate &&
		a.maximumLevel === b.maximumLevel
	);
}
