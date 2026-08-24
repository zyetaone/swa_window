/**
 * validateAmbientValue — the localStorage / peer wire trust boundary.
 *
 * The 'zone' spec kind exists for director.daylight.timeZoneOverride: an
 * IANA zone id is the only non-URL string that crosses this wire, and a
 * garbage zone would silently fall back in the time pipeline, so invalid
 * values must be DROPPED here, not carried.
 */
import { describe, it, expect } from 'vitest';
import { validateAmbientValue, PEER_SYNC_PATHS } from '$lib/model/peer-sync-paths';

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
