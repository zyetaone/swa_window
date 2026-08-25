/**
 * Elevation from AWS terrarium tiles — open data (SRTM / 3DEP derived), no key,
 * no licence to honour beyond attribution.
 *
 * Terrarium encodes metres in RGB: (R * 256 + G + B / 256) - 32768. We decode a
 * tile to a Float32Array and hand it to Cesium's own HeightmapTerrainData, so
 * none of the meshing is ours.
 */
import type { CesiumModule } from '#lib/cesium/types.js';

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/** Terrarium publishes z0-15; past that the data is resampled, not finer. */
export const TERRARIUM_MAX_LEVEL = 13;
const TILE_PX = 256;

export function terrariumTileUrl(z: number, x: number, y: number): string {
	return `${TERRARIUM_URL}/${z}/${x}/${y}.png`;
}

/** RGB -> metres, per the terrarium spec. */
export function decodeElevation(r: number, g: number, b: number): number {
	return r * 256 + g + b / 256 - 32768;
}

async function fetchHeights(z: number, x: number, y: number): Promise<Float32Array> {
	const res = await fetch(terrariumTileUrl(z, x, y));
	if (!res.ok) throw new Error(`terrarium ${z}/${x}/${y}: ${res.status}`);
	const bitmap = await createImageBitmap(await res.blob());
	const canvas = new OffscreenCanvas(TILE_PX, TILE_PX);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('no 2d context for terrarium decode');
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();
	const { data } = ctx.getImageData(0, 0, TILE_PX, TILE_PX);

	const heights = new Float32Array(TILE_PX * TILE_PX);
	for (let i = 0, p = 0; i < heights.length; i++, p += 4) {
		heights[i] = decodeElevation(data[p], data[p + 1], data[p + 2]);
	}
	return heights;
}

/**
 * Minimal TerrainProvider. Cesium owns the tiling scheme and the mesh; we only
 * supply heights, so there is nothing here to get subtly wrong.
 */
export function createTerrariumProvider(Cesium: CesiumModule) {
	const tilingScheme = new Cesium.WebMercatorTilingScheme();
	const errorEvent = new Cesium.Event();
	const levelZeroError = Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
		tilingScheme.ellipsoid,
		TILE_PX,
		tilingScheme.getNumberOfXTilesAtLevel(0)
	);

	return {
		tilingScheme,
		errorEvent,
		credit: new Cesium.Credit('Elevation: Mapzen / AWS Open Data (SRTM, 3DEP)'),
		hasWaterMask: false,
		hasVertexNormals: false,
		availability: undefined,
		get ready(): boolean {
			return true;
		},
		getLevelMaximumGeometricError(level: number): number {
			return levelZeroError / (1 << level);
		},
		getTileDataAvailable(_x: number, _y: number, level: number): boolean {
			return level <= TERRARIUM_MAX_LEVEL;
		},
		loadTileDataAvailability(): undefined {
			return undefined;
		},
		requestTileGeometry(x: number, y: number, level: number) {
			if (level > TERRARIUM_MAX_LEVEL) return undefined;
			return fetchHeights(level, x, y).then(
				(buffer) =>
					new Cesium.HeightmapTerrainData({
						buffer,
						width: TILE_PX,
						height: TILE_PX,
						structure: {
							heightScale: 1,
							heightOffset: 0,
							elementsPerHeight: 1,
							stride: 1,
							elementMultiplier: 1,
							isBigEndian: false
						}
					})
			);
		}
	};
}
