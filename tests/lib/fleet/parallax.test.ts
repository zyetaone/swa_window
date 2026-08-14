/**
 * Tests for $lib/fleet/parallax.svelte.ts — multi-Pi role resolution,
 * leader/follower logic, and localStorage persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	isGroupLeader,
	isEdgePane,
	showsOpsChrome,
	showsOpenPassengerHud,
	isOpsModeParam,
	shouldApplyDirectorDecision,
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

// ─── chrome role gates (shell SSOT) ───────────────────────────────────────

describe('isEdgePane', () => {
	it('is true for left and right only', () => {
		expect(isEdgePane('left')).toBe(true);
		expect(isEdgePane('right')).toBe(true);
		expect(isEdgePane('center')).toBe(false);
		expect(isEdgePane('solo')).toBe(false);
	});
});

describe('showsOpsChrome', () => {
	// The regression this pins: the gate used to be `opsMode || isGroupLeader`,
	// so a solo kiosk and every corridor's centre pane wore a visible operator
	// chevron 24/7 — a permanent tell on a display that must not read as a
	// computer, and an asymmetry the 3-pane seam showed off.
	it('shows nothing on a production kiosk, whatever the role', () => {
		expect(showsOpsChrome(false, false)).toBe(false);
	});
	it('shows when the URL asks for it (?ops=1)', () => {
		expect(showsOpsChrome(true, false)).toBe(true);
	});
	it('shows in dev without any URL param — no audience to break the fiction for', () => {
		expect(showsOpsChrome(false, true)).toBe(true);
	});
	it('defaults to hidden when called with no arguments', () => {
		expect(showsOpsChrome()).toBe(false);
	});
});

describe('showsOpenPassengerHud', () => {
	it('requires hudVisible and a non-edge role', () => {
		expect(showsOpenPassengerHud('solo', true)).toBe(true);
		expect(showsOpenPassengerHud('center', true)).toBe(true);
		expect(showsOpenPassengerHud('left', true)).toBe(false);
		expect(showsOpenPassengerHud('right', true)).toBe(false);
		expect(showsOpenPassengerHud('solo', false)).toBe(false);
	});
});

describe('isOpsModeParam', () => {
	it('accepts ops=1 and ops=true', () => {
		expect(isOpsModeParam('?ops=1')).toBe(true);
		expect(isOpsModeParam('ops=true')).toBe(true);
		expect(isOpsModeParam(new URLSearchParams('ops=1'))).toBe(true);
	});
	it('rejects missing or other values', () => {
		expect(isOpsModeParam('')).toBe(false);
		expect(isOpsModeParam('?ops=0')).toBe(false);
		expect(isOpsModeParam(null)).toBe(false);
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
