/**
 * Tests for $lib/fleet/parallax.svelte.ts — multi-Pi role resolution,
 * leader/follower logic, heading offset math, and localStorage persistence.
 *
 * This is Phase 7 glue that every non-solo Pi relies on at startup.
 * Bugs here mean wrong yaw on the corridor panorama and silent fleet desync.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	isGroupLeader,
	shouldApplyDirectorDecision,
	headingOffsetForRole,
	resolveBinding,
	saveBinding,
	listBindings,
	getDeviceFingerprint,
} from '$lib/fleet/parallax.svelte';

// ─── isGroupLeader ──────────────────────────────────────────────────────────

describe('isGroupLeader', () => {
	it('returns true for solo', () => {
		expect(isGroupLeader('solo')).toBe(true);
	});
	it('returns true for center', () => {
		expect(isGroupLeader('center')).toBe(true);
	});
	it('returns false for left', () => {
		expect(isGroupLeader('left')).toBe(false);
	});
	it('returns false for right', () => {
		expect(isGroupLeader('right')).toBe(false);
	});
});

// ─── shouldApplyDirectorDecision ───────────────────────────────────────────

describe('shouldApplyDirectorDecision', () => {
	it('applies when msg has no groupId (legacy/unscoped broadcast)', () => {
		expect(shouldApplyDirectorDecision('any', undefined)).toBe(true);
	});
	it('applies when msg uses wildcard groupId', () => {
		expect(shouldApplyDirectorDecision('lefthall', '*')).toBe(true);
	});
	it('applies when msg groupId matches my group', () => {
		expect(shouldApplyDirectorDecision('lefthall', 'lefthall')).toBe(true);
	});
	it('ignores when msg groupId targets a different group', () => {
		expect(shouldApplyDirectorDecision('lefthall', 'righthall')).toBe(false);
	});
	it('applies when both are empty strings (degenerate but non-throwing)', () => {
		expect(shouldApplyDirectorDecision('', '')).toBe(true);
	});
});

// ─── headingOffsetForRole — parallax math ───────────────────────────────────

describe('headingOffsetForRole', () => {
	it('returns 0 for solo', () => {
		expect(headingOffsetForRole('solo')).toBe(0);
	});
	it('returns 0 for center', () => {
		expect(headingOffsetForRole('center')).toBe(0);
	});
	it('returns negative offset for left with default arc', () => {
		const arc = 44;
		const expected = -arc / 2 + arc / 6; // -22 + 7.333 = -14.666
		expect(headingOffsetForRole('left')).toBeCloseTo(expected, 5);
	});
	it('returns positive offset for right with default arc', () => {
		const arc = 44;
		const expected = arc / 2 - arc / 6; // 22 - 7.333 = 14.666
		expect(headingOffsetForRole('right')).toBeCloseTo(expected, 5);
	});
	it('left and right are symmetric around 0', () => {
		expect(headingOffsetForRole('left')).toBeCloseTo(-headingOffsetForRole('right'), 5);
	});
	it('scales linearly with panoramaArcDeg', () => {
		expect(headingOffsetForRole('right', 60)).toBeCloseTo(60 / 2 - 60 / 6, 5);
		expect(headingOffsetForRole('right', 90)).toBeCloseTo(90 / 2 - 90 / 6, 5);
	});
});

// ─── resolveBinding / saveBinding — localStorage persistence ───────────────

describe('resolveBinding (localStorage)', () => {
	beforeEach(() => {
		// Fresh localStorage + default URL for each test
		localStorage.clear();
		Object.defineProperty(window, 'location', {
			value: { search: '' },
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		localStorage.clear();
	});

	it('returns default solo binding when nothing is stored', () => {
		const binding = resolveBinding();
		expect(binding.role).toBe('solo');
		expect(binding.groupId).toBe('default');
	});

	it('honours a URL role param over storage', () => {
		Object.defineProperty(window, 'location', {
			value: { search: '?role=left&group=corridor1' },
			writable: true,
			configurable: true,
		});
		const binding = resolveBinding();
		expect(binding.role).toBe('left');
		expect(binding.groupId).toBe('corridor1');
	});

	it('ignores an invalid URL role param', () => {
		Object.defineProperty(window, 'location', {
			value: { search: '?role=nonexistent' },
			writable: true,
			configurable: true,
		});
		const binding = resolveBinding();
		expect(binding.role).toBe('solo');
	});

	it('persists binding to fingerprint map after URL-based resolution', () => {
		Object.defineProperty(window, 'location', {
			value: { search: '?role=right' },
			writable: true,
			configurable: true,
		});
		resolveBinding();
		const bindings = listBindings();
		expect(bindings.length).toBeGreaterThan(0);
		expect(bindings[0].binding.role).toBe('right');
	});

	it('recovers a fingerprint-keyed binding across page reloads', () => {
		const fp = getDeviceFingerprint();
		saveBinding(fp, { role: 'center', groupId: 'hallway' });
		const binding = resolveBinding();
		expect(binding.role).toBe('center');
		expect(binding.groupId).toBe('hallway');
	});

	it('rejects saveBinding with an invalid role (silent no-op)', () => {
		const fp = getDeviceFingerprint();
		saveBinding(fp, { role: 'invalid' as 'left', groupId: 'x' });
		const map = listBindings();
		// fingerprint entry should not have been written
		expect(map.find((e) => e.fingerprint === fp)).toBeUndefined();
	});
});

// ─── getDeviceFingerprint ──────────────────────────────────────────────────

describe('getDeviceFingerprint', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('returns a stable string on repeated calls', () => {
		const a = getDeviceFingerprint();
		const b = getDeviceFingerprint();
		expect(a).toBe(b);
	});

	it('produces a non-empty 8-hex-char fingerprint', () => {
		const fp = getDeviceFingerprint();
		expect(fp).toMatch(/^[0-9a-f]{8}$/);
	});

	it('persists fingerprint to localStorage', () => {
		const fp = getDeviceFingerprint();
		expect(localStorage.getItem('aero.device.fingerprint')).toBe(fp);
	});
});
