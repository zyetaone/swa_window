import type maplibregl from 'maplibre-gl';

// Pure state holder — NO $effect here (requires component context).
// The camera sync $effect lives in MapLibreGlobe.svelte.
export const globeCamera = $state({
	mapRef: null as maplibregl.Map | null,
	lat: 0,
	lon: 0,
	zoom: undefined as number | undefined,
	pitch: 45,
	bearing: 0,
	freeCam: false,
	cameraInit: false,
	prevTarget: { lat: 0, lon: 0 },
});

export const getEffectiveZoom = () => 10.5;

/** Call this from a component $effect — syncs camera state to MapLibre. */
export function syncCamera() {
	const mapRef = globeCamera.mapRef;
	if (!mapRef) return;
	if (import.meta.env.DEV) (window as any).__map = mapRef;

	const target = { center: [globeCamera.lon, globeCamera.lat] as [number, number], zoom: getEffectiveZoom(), pitch: globeCamera.pitch, bearing: globeCamera.bearing };

	if (!globeCamera.cameraInit) {
		const apply = () => {
			mapRef!.jumpTo(target);
			mapRef!.setPitch(globeCamera.pitch);
			mapRef!.setBearing(globeCamera.bearing);
			globeCamera.cameraInit = true;
		};
		if (mapRef.isStyleLoaded()) apply();
		else mapRef.once('idle', apply);
		globeCamera.prevTarget = { lat: globeCamera.lat, lon: globeCamera.lon };
		return;
	}
	if (globeCamera.freeCam) return;

	const distSq = Math.pow(globeCamera.lat - globeCamera.prevTarget.lat, 2) + Math.pow(globeCamera.lon - globeCamera.prevTarget.lon, 2);
	if (distSq > 0.001) {
		mapRef.stop();
		mapRef.easeTo({ ...target, duration: 2500 });
	} else {
		mapRef.jumpTo(target);
	}
	globeCamera.prevTarget = { lat: globeCamera.lat, lon: globeCamera.lon };
}

export function flyTo(dst: { lat: number; lon: number; altitude?: number }, _duration = 2000) {
	if (!globeCamera.mapRef) return;
	const z = dst.altitude ? Math.max(8, 18 - (dst.altitude / 5000)) : getEffectiveZoom();
	globeCamera.mapRef.flyTo({ center: [dst.lon, dst.lat], zoom: z, duration: _duration });
}
