import type maplibregl from 'maplibre-gl';

// Pure state holder — NO $effect here.
export const globeFilters = $state({
	mapRef: null as maplibregl.Map | null,
	nightFactor: 0,
});

export const getBaseBrightness = () => 1.0 - (globeFilters.nightFactor * 0.92);
export const getBaseSaturation = () => 1.0 - (globeFilters.nightFactor * 0.82);
export const getBaseContrast = () => 1.0 + globeFilters.nightFactor * 0.6;
export const getNightBrightness = () => Math.max(0.15, 1 - globeFilters.nightFactor * 1.5);

/** Call from a component $effect — applies night dimming to base satellite layer. */
export function applyNightFilters() {
	const mapRef = globeFilters.mapRef;
	if (!mapRef) return;
	const m = mapRef;
	const apply = () => {
		try {
			if (m.getLayer('sat-imagery')) {
				m.setPaintProperty('sat-imagery', 'raster-brightness-max', getBaseBrightness());
				m.setPaintProperty('sat-imagery', 'raster-brightness-min', globeFilters.nightFactor > 0.5 ? 0.02 : 0.08);
				m.setPaintProperty('sat-imagery', 'raster-saturation', getBaseSaturation() - 1);
				m.setPaintProperty('sat-imagery', 'raster-contrast', getBaseContrast() - 1);
			}
		} catch(e) {
			console.warn('Failed to apply night filters to base layer', e);
		}
	};
	if (mapRef.loaded() && mapRef.isStyleLoaded()) apply();
	else {
		mapRef.once('load', apply);
		mapRef.once('styledata', apply);
	}
}
