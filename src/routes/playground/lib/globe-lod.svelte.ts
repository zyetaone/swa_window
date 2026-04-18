import type maplibregl from 'maplibre-gl';

// Pure state holder — NO $effect here.
export const globeLod = $state({
	mapRef: null as maplibregl.Map | null,
	lodMaxZoomLevels: 6,
	lodTileCountRatio: 2.0,
});

export function applyLodParams(mapRef: maplibregl.Map, lodMaxZoomLevels: number, lodTileCountRatio: number) {
	try {
		(mapRef as any).setSourceTileLodParams?.(lodMaxZoomLevels, lodTileCountRatio);
	} catch (e) {
		console.warn('[MapLibre] setSourceTileLodParams failed:', e);
	}
}

/** Call from a component $effect — applies LOD settings to map. */
export function syncLod() {
	const mapRef = globeLod.mapRef;
	if (!mapRef) return;
	const apply = () => applyLodParams(mapRef, globeLod.lodMaxZoomLevels, globeLod.lodTileCountRatio);
	if (mapRef.loaded()) apply();
	else mapRef.once('load', apply);
}
