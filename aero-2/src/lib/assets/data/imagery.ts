/**
 * Base textures, and how much detail to spend on them.
 * Authored tuning only: no logic, no imports.
 */

export interface ImagerySource {
	readonly id: string;
	readonly urlTemplate: string;
	readonly zoomRange: readonly [number, number];
	readonly nightAnchor: number;
}

export const IMAGERY_SOURCES: readonly ImagerySource[] = [
	{
		id: 'eox-sentinel2',
		urlTemplate: '/api/tiles/eox-sentinel2/{z}/{y}/{x}.jpg',
		zoomRange: [4, 12],
		nightAnchor: 0,
	},
	{
		id: 'esri-world-imagery',
		urlTemplate: '/api/tiles/esri-world-imagery/{z}/{y}/{x}.jpg',
		zoomRange: [4, 14],
		nightAnchor: 0.01,
	},
	{
		id: 'cartodb-dark',
		urlTemplate: '/api/tiles/cartodb-dark/{z}/{y}/{x}.png',
		zoomRange: [4, 12],
		nightAnchor: 1,
	},
];

/** Day layers in preference order (matches v1 local cache). */
export const DAY_IMAGERY_IDS = ['eox-sentinel2', 'esri-world-imagery'] as const;
export const SSE_GROUND = 2;
export const SSE_CRUISE = 24;
