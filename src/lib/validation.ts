/**
 * Fleet validation constants — single source of truth for allowlists
 * used by fleet handlers, persistence, and app-state patch validation.
 */

import { WEATHER_TYPES, DISPLAY_MODES, QUALITY_MODES } from '$lib/types';
import type { WeatherType, DisplayMode, QualityMode } from '$lib/types';

/** Type-safe membership check for union-type allowlists. */
export function isValidWeather(v: unknown): v is WeatherType {
	return typeof v === 'string' && (WEATHER_TYPES as readonly string[]).includes(v);
}

export function isValidDisplayMode(v: unknown): v is DisplayMode {
	return typeof v === 'string' && (DISPLAY_MODES as readonly string[]).includes(v);
}

export function isValidQualityMode(v: unknown): v is QualityMode {
	return typeof v === 'string' && (QUALITY_MODES as readonly string[]).includes(v);
}

/** Safe JSON parse — returns null on failure instead of throwing. */
export function safeParse<T = unknown>(raw: string): T | null {
	try { return JSON.parse(raw); }
	catch { return null; }
}
