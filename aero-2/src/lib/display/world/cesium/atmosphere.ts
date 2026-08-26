import type * as CesiumType from 'cesium';

/**
 * Configure Cesium globe atmosphere, Rayleigh sky, baseline oceanic color, and lighting.
 */
export function setupCesiumAtmosphere(
	Cesium: typeof CesiumType,
	viewer: CesiumType.Viewer,
	options: {
		enableLighting?: boolean;
		showAtmosphere?: boolean;
		baseColorHex?: string;
	} = {}
) {
	viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(options.baseColorHex ?? '#24364f');
	viewer.scene.globe.enableLighting = options.enableLighting ?? false;
	viewer.scene.globe.depthTestAgainstTerrain = false;
	viewer.scene.globe.show = true;
	if (viewer.scene.skyAtmosphere) {
		viewer.scene.skyAtmosphere.show = options.showAtmosphere ?? true;
	}
}
