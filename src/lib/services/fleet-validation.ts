/**
 * Fleet validation constants — single source of truth for allowlists
 * used by fleet handlers, persistence, and app-state patch validation.
 */

import type { WeatherType } from '$lib/shared/types';
import type { DisplayMode } from '$lib/shared/protocol';
import type { QualityMode } from '$lib/shared/constants';

export const VALID_WEATHER: readonly WeatherType[] = ['clear', 'cloudy', 'rain', 'overcast', 'storm'] as const;
export const VALID_DISPLAY_MODES: readonly DisplayMode[] = ['flight', 'screensaver', 'video'] as const;
export const VALID_QUALITY_MODES: readonly QualityMode[] = ['performance', 'balanced', 'ultra'] as const;

/** Type-safe membership check for union-type allowlists. */
export function isValidWeather(v: unknown): v is WeatherType {
	return typeof v === 'string' && (VALID_WEATHER as readonly string[]).includes(v);
}

export function isValidDisplayMode(v: unknown): v is DisplayMode {
	return typeof v === 'string' && (VALID_DISPLAY_MODES as readonly string[]).includes(v);
}

export function isValidQualityMode(v: unknown): v is QualityMode {
	return typeof v === 'string' && (VALID_QUALITY_MODES as readonly string[]).includes(v);
}

/** Safe JSON parse — returns null on failure instead of throwing. */
export function safeParse<T = unknown>(raw: string): T | null {
	try { return JSON.parse(raw); }
	catch { return null; }
}
