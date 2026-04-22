/**
 * Tests for $lib/fleet/protocol.ts — version discrimination, type guards.
 *
 * Protocol v1/v2 coexist on the wire. A mis-classified message is a silent
 * fleet desync — these tests pin the discrimination boundary so any
 * regression surfaces immediately.
 */
import { describe, it, expect } from 'vitest';
import { isV2 } from '$lib/fleet/protocol';

describe('isV2 — version discriminator', () => {
	it('returns true for a well-formed v2 message', () => {
		expect(isV2({ v: 2, type: 'config_patch', path: 'shell.hudVisible', value: true })).toBe(true);
	});

	it('returns true for any v2 type (role_assign)', () => {
		expect(isV2({ v: 2, type: 'role_assign', deviceId: 'dev1', role: 'left' })).toBe(true);
	});

	it('returns true for any v2 type (director_decision)', () => {
		expect(
			isV2({
				v: 2,
				type: 'director_decision',
				scenarioId: 'autopilot',
				locationId: 'dallas',
				decidedAtMs: 0,
				transitionAtMs: 2500,
			}),
		).toBe(true);
	});

	it('returns false for a v1-style flat-patch message (no v field)', () => {
		expect(isV2({ type: 'patch', patch: { altitude: 30000 } })).toBe(false);
	});

	it('returns false for v=1 explicit', () => {
		expect(isV2({ v: 1, type: 'patch' })).toBe(false);
	});

	it('returns false for a string v (type coercion guard)', () => {
		expect(isV2({ v: '2', type: 'config_patch' })).toBe(false);
	});

	it('returns false for null', () => {
		expect(isV2(null)).toBe(false);
	});

	it('returns false for undefined', () => {
		expect(isV2(undefined)).toBe(false);
	});

	it('returns false for a non-object (string)', () => {
		expect(isV2('{"v":2}')).toBe(false);
	});

	it('returns false for a non-object (number)', () => {
		expect(isV2(42)).toBe(false);
	});

	it('returns false for an array', () => {
		expect(isV2([{ v: 2 }])).toBe(false);
	});

	it('returns false for an empty object', () => {
		expect(isV2({})).toBe(false);
	});

	it('returns true when additional fields are present (extensibility)', () => {
		expect(isV2({ v: 2, type: 'config_patch', path: 'x.y', value: 1, future: 'field' })).toBe(true);
	});

	it('returns true even without a type (caller is responsible for dispatch)', () => {
		// isV2 is only the version check; type-level dispatch happens downstream.
		expect(isV2({ v: 2 })).toBe(true);
	});
});
