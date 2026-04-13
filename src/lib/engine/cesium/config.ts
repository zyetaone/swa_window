/**
 * Cesium Global Config
 *
 * Centralizes Ion tokens and environmental settings for the Cesium engine.
 */

import type * as CesiumType from 'cesium';

// Environment markers
export const TILE_SERVER_URL = import.meta.env.VITE_TILE_SERVER_URL || null;

/**
 * Access the Cesium Ion token from environment variables.
 * Falls back to null if the default placeholder is detected.
 */
export function getIonToken(): string | null {
	const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
	if (!token || token === 'your-cesium-ion-token-here') return null;
	return token;
}

/**
 * Perform one-time global initialization for the Cesium module.
 */
export function initCesiumGlobal(C: typeof CesiumType): void {
	const token = getIonToken();
	if (token) {
		C.Ion.defaultAccessToken = token;
	}

	// Set base URL for static assets (workers, etc.)
	(globalThis as any).CESIUM_BASE_URL = '/cesiumStatic';
}

/**
 * Check if the local tile server is online.
 */
export async function checkLocalTileServer(): Promise<boolean> {
	if (!TILE_SERVER_URL) return false;
	try {
		const resp = await fetch(`${TILE_SERVER_URL}/health`, {
			signal: AbortSignal.timeout(500)
		});
		return resp.ok;
	} catch {
		return false;
	}
}
