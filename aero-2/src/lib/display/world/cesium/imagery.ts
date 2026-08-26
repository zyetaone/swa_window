import type * as CesiumType from 'cesium';

export type CesiumProviderType = 'sentinel' | 'gibs' | 'osm';

/**
 * Configure satellite imagery and night light layers for Cesium.
 */
export function setupCesiumImagery(
	Cesium: typeof CesiumType,
	viewer: CesiumType.Viewer,
	providerType: CesiumProviderType = 'sentinel'
) {
	let primaryProvider: CesiumType.ImageryProvider;

	if (providerType === 'osm') {
		primaryProvider = new Cesium.OpenStreetMapImageryProvider({
			url: 'https://tile.openstreetmap.org/'
		});
	} else if (providerType === 'gibs') {
		primaryProvider = new Cesium.UrlTemplateImageryProvider({
			url: '/api/tiles/xyz/gibs/{z}/{x}/{y}.jpg',
			tilingScheme: new Cesium.WebMercatorTilingScheme(),
			maximumLevel: 9,
			credit: 'NASA EOSDIS GIBS'
		});
	} else {
		// Default EOX Sentinel-2 Cloudless 2024 (high-res natural color, free, global)
		primaryProvider = new Cesium.UrlTemplateImageryProvider({
			url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
			tilingScheme: new Cesium.WebMercatorTilingScheme(),
			maximumLevel: 14,
			credit: 'Sentinel-2 cloudless by EOX IT Services GmbH'
		});
	}

	const baseLayer = new Cesium.ImageryLayer(primaryProvider);
	viewer.imageryLayers.removeAll();
	viewer.imageryLayers.add(baseLayer);

	// VIIRS Night Lights Layer
	const viirsProvider = new Cesium.UrlTemplateImageryProvider({
		url: '/api/tiles/xyz/viirs/{z}/{x}/{y}.png',
		tilingScheme: new Cesium.WebMercatorTilingScheme(),
		maximumLevel: 8
	});
	const viirsLayer = viewer.imageryLayers.addImageryProvider(viirsProvider);
	viirsLayer.alpha = 0.0;

	return {
		baseLayer,
		viirsLayer,
		setNightAlpha: (alpha: number) => {
			if (viirsLayer) {
				viirsLayer.alpha = Math.max(0, Math.min(0.85, alpha));
			}
		}
	};
}
