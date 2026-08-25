/**
 * validateAmbientValue — the localStorage / peer wire trust boundary.
 *
 * The 'zone' spec kind exists for director.daylight.timeZoneOverride: an
 * IANA zone id is the only non-URL string that crosses this wire, and a
 * garbage zone would silently fall back in the time pipeline, so invalid
 * values must be DROPPED here, not carried.
 */
import { describe, it, expect } from 'vitest';
import { AMBIENT_PATH_SPECS, validateAmbientValue, PEER_SYNC_PATHS } from '$lib/model/peer-sync-paths';
import { atmosphere, director } from '$lib/model/config-tree.svelte';
import { NIGHT_LIGHT_SCALE_MAX } from '$lib/world/altitude';

describe('validateAmbientValue — zone kind', () => {
	const PATH = 'director.daylight.timeZoneOverride';

	it('is registered as a peer-sync path (admin override fans out + persists)', () => {
		expect(PEER_SYNC_PATHS).toContain(PATH);
	});

	it('round-trips the empty string (follow the depicted location)', () => {
		expect(validateAmbientValue(PATH, '')).toBe('');
	});

	it('accepts real IANA zone ids', () => {
		expect(validateAmbientValue(PATH, 'America/Chicago')).toBe('America/Chicago');
		expect(validateAmbientValue(PATH, 'UTC')).toBe('UTC');
	});

	it('drops invalid zones and non-strings', () => {
		expect(validateAmbientValue(PATH, 'Not/AZone')).toBeUndefined();
		expect(validateAmbientValue(PATH, -6)).toBeUndefined();
		expect(validateAmbientValue(PATH, null)).toBeUndefined();
	});
});

/**
 * The bounds in AMBIENT_PATH_SPECS are restated from the config tree rather
 * than imported — peer-sync-paths must stay pure data so persistence.ts can
 * use it without pulling in a rune module. This is the drift detector that
 * restatement needs, and it lives here because a TEST may import both.
 *
 * A spec bound WIDER than its slider is the dangerous direction:
 * validateAmbientValue clamps to the SPEC, so a restored or peer-synced value
 * can land somewhere no operator could set and none of them can see is wrong.
 * Both of these had drifted exactly that way.
 */
describe('ambient spec bounds match the operator-facing ranges', () => {
	it('cloud speed matches the config-tree bounds the slider is built from', () => {
		// Was 0.1..3 against a 0.2..1.5 slider.
		const spec = AMBIENT_PATH_SPECS['atmosphere.clouds.speed'];
		expect(spec.min).toBe(director.ambient.cloudSpeedMin);
		expect(spec.max).toBe(director.ambient.cloudSpeedMax);
	});

	it('haze matches its config-tree bounds', () => {
		const spec = AMBIENT_PATH_SPECS['atmosphere.haze.amount'];
		expect(spec.min).toBe(atmosphere.haze.min);
		expect(spec.max).toBe(atmosphere.haze.max);
	});

	it('night-light intensity matches the shared scale ceiling', () => {
		expect(AMBIENT_PATH_SPECS['world.nightLightIntensity'].max).toBe(NIGHT_LIGHT_SCALE_MAX);
	});

	it('never lets a restored moon outshine the slider maximum', () => {
		// Was 1.0 against a 0.3 slider — over 3x maximum brightness, restorable
		// on boot and not reachable from the panel. The floor deliberately stays
		// 0 (moon off) rather than tracking the slider's 0.035.
		const spec = AMBIENT_PATH_SPECS['world.moonlightIntensity'];
		expect(spec.max).toBe(0.3);
		expect(validateAmbientValue('world.moonlightIntensity', 1.0)).toBe(0.3);
	});

	it('clamps rather than drops an out-of-range number', () => {
		// The contract persistence.ts relies on: numbers clamp, they do not
		// vanish, so a stale stored value degrades toward legal instead of
		// silently reverting to a code default.
		expect(validateAmbientValue('atmosphere.clouds.speed', 99)).toBe(director.ambient.cloudSpeedMax);
		expect(validateAmbientValue('atmosphere.clouds.speed', -5)).toBe(director.ambient.cloudSpeedMin);
	});
});
