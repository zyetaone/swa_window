/**
 * applyConfigPatch — Fleet v2 wire + localStorage DTO boundary.
 *
 * This is architectural invariant 2 from CLAUDE.md: path-targeted patches
 * flow through applyConfigPatch into the matching namespace. The tests
 * cover the invariant (unknown paths return false, valid paths mutate the
 * right leaf, layer dispatch is exhaustive, nested paths work) so that
 * fleet desync bugs surface here instead of in production.
 */
import { describe, it, expect } from 'vitest';
import {
	applyConfigPatch,
	atmosphere,
	camera,
	director,
	world,
	shell,
} from '$lib/model/config-tree.svelte';

// Test-only snapshot helpers — moved out of the production module (their
// only consumer is this file).
function deepSnapshot(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === null || v === undefined) {
			out[k] = v;
		} else if (Array.isArray(v)) {
			out[k] = [...v];
		} else if (typeof v === 'object') {
			out[k] = deepSnapshot(v as Record<string, unknown>);
		} else {
			out[k] = v;
		}
	}
	return out;
}

function configSnapshot() {
	return {
		atmosphere: deepSnapshot(atmosphere as unknown as Record<string, unknown>),
		camera:    deepSnapshot(camera as unknown as Record<string, unknown>),
		director:  deepSnapshot(director as unknown as Record<string, unknown>),
		world:     deepSnapshot(world as unknown as Record<string, unknown>),
		shell:     deepSnapshot(shell as unknown as Record<string, unknown>),
	};
}

// ─── applyConfigPatch — layer dispatch ──────────────────────────────────────

describe('applyConfigPatch', () => {
	it('returns false for a path without a layer separator', () => {
		expect(applyConfigPatch('justonesegment', 1)).toBe(false);
	});

	it('returns false for an empty path', () => {
		expect(applyConfigPatch('', 1)).toBe(false);
	});

	it('returns false for an unknown layer', () => {
		expect(applyConfigPatch('unknownlayer.something', 1)).toBe(false);
	});

	it('dispatches to atmosphere layer for atmosphere.* paths', () => {
		const original = atmosphere.clouds.density;
		const ok = applyConfigPatch('atmosphere.clouds.density', 0.42);
		expect(ok).toBe(true);
		expect(atmosphere.clouds.density).toBe(0.42);
		atmosphere.clouds.density = original; // restore
	});

	it('dispatches to camera layer for camera.* paths', () => {
		const original = camera.orbit.driftRate;
		const ok = applyConfigPatch('camera.orbit.driftRate', 0.05);
		expect(ok).toBe(true);
		expect(camera.orbit.driftRate).toBe(0.05);
		camera.orbit.driftRate = original;
	});

	it('dispatches to director layer for director.* paths', () => {
		const original = director.daylight.manualTimeOfDay;
		const ok = applyConfigPatch('director.daylight.manualTimeOfDay', 17);
		expect(ok).toBe(true);
		expect(director.daylight.manualTimeOfDay).toBe(17);
		director.daylight.manualTimeOfDay = original;
	});

	it('dispatches to world layer for world.* paths', () => {
		const original = world.buildingsEnabled;
		const ok = applyConfigPatch('world.buildingsEnabled', !original);
		expect(ok).toBe(true);
		expect(world.buildingsEnabled).toBe(!original);
		world.buildingsEnabled = original;
	});

	it('dispatches to shell layer for shell.* paths', () => {
		const original = shell.hudVisible;
		const ok = applyConfigPatch('shell.hudVisible', !original);
		expect(ok).toBe(true);
		expect(shell.hudVisible).toBe(!original);
		shell.hudVisible = original;
	});
});

// ─── setByPath (per-layer) — deep paths, unknown keys, type coercion ────────

describe('setByPath behaviour (via applyConfigPatch)', () => {
	it('returns false for a key that does not exist on the object', () => {
		const ok = applyConfigPatch('atmosphere.clouds.nonexistentField', 'x');
		expect(ok).toBe(false);
	});

	it('returns false when an intermediate segment is not an object', () => {
		// atmosphere.clouds.density is a number; can't descend into a number
		const ok = applyConfigPatch('atmosphere.clouds.density.foo', 1);
		expect(ok).toBe(false);
	});

	it('returns false for a nested path where the leaf key is missing', () => {
		const ok = applyConfigPatch('camera.orbit.nope', 1);
		expect(ok).toBe(false);
	});

	it('rejects writes whose value type does not match the existing leaf', () => {
		// applyConfigPatch enforces a type guard (config-tree.svelte.ts:420)
		// so a runaway 'potato' string can't land in a number/boolean field
		// and corrupt downstream consumers. Reject + no mutation.
		const original = shell.hudVisible;
		const ok = applyConfigPatch('shell.hudVisible', 'not-a-boolean' as unknown as boolean);
		expect(ok).toBe(false);
		expect(shell.hudVisible).toBe(original);
	});
});

// ─── applyConfigPatch — via the public API ──────────────────────────────────

describe('applyConfigPatch — wire-level scenarios', () => {
	it('round-trips a fleet config_patch for atmosphere cloud density', () => {
		const orig = atmosphere.clouds.density;
		applyConfigPatch('atmosphere.clouds.density', 0.9);
		expect(atmosphere.clouds.density).toBe(0.9);
		applyConfigPatch('atmosphere.clouds.density', orig);
		expect(atmosphere.clouds.density).toBe(orig);
	});

	it('handles a deep nested path (camera.parallax.role)', () => {
		const orig = camera.parallax.role;
		const ok = applyConfigPatch('camera.parallax.role', 'left');
		expect(ok).toBe(true);
		expect(camera.parallax.role).toBe('left');
		applyConfigPatch('camera.parallax.role', orig);
	});

	// The role is not a plain leaf: headingOffsetDeg (panorama yaw) and
	// fuselageOffsetM (seat position) DERIVE from it. A patch that set the
	// role but left the previous role's offsets in place would misalign the
	// 3-Pi seam with nothing logged, so the derivation lives inside
	// applyConfigPatch rather than in each caller.
	it('derives parallax offsets when the role is patched directly', () => {
		const orig = camera.parallax.role;

		applyConfigPatch('camera.parallax.role', 'solo');
		expect(camera.parallax.headingOffsetDeg).toBe(0);
		expect(camera.parallax.fuselageOffsetM).toBe(0);

		applyConfigPatch('camera.parallax.role', 'left');
		const leftHeading = camera.parallax.headingOffsetDeg;
		const leftFuselage = camera.parallax.fuselageOffsetM;
		expect(leftHeading).toBeLessThan(0);

		applyConfigPatch('camera.parallax.role', 'right');
		expect(camera.parallax.headingOffsetDeg).toBe(-leftHeading);
		expect(camera.parallax.fuselageOffsetM).toBe(-leftFuselage);

		// Back to solo — offsets must return to zero, not stay at 'right'.
		applyConfigPatch('camera.parallax.role', 'solo');
		expect(camera.parallax.headingOffsetDeg).toBe(0);
		expect(camera.parallax.fuselageOffsetM).toBe(0);

		applyConfigPatch('camera.parallax.role', orig);
	});

	it('derives parallax offsets on a winning remote (CRDT) role patch', () => {
		const orig = camera.parallax.role;
		applyConfigPatch('camera.parallax.role', 'solo');

		// +1000 ms: the local 'solo' write above stamped Date.now(), and an
		// equal timestamp falls to the lexicographic sourceId tiebreak. A real
		// remote assignment arrives later than the local state it replaces.
		const ok = applyConfigPatch('camera.parallax.role', 'right', {
			timestamp: Date.now() + 1000,
			sourceId: 'admin-test',
		});
		expect(ok).toBe(true);
		expect(camera.parallax.role).toBe('right');
		expect(camera.parallax.headingOffsetDeg).toBeGreaterThan(0);

		applyConfigPatch('camera.parallax.role', orig);
	});

	it('rejects a path outside the five known layers without mutating state', () => {
		const before = configSnapshot();
		const ok = applyConfigPatch('wrongroot.something', 1);
		expect(ok).toBe(false);
		const after = configSnapshot();
		expect(after).toEqual(before);
	});

	it('rejects an unknown field under a known layer', () => {
		const ok = applyConfigPatch('shell.doesNotExist', true);
		expect(ok).toBe(false);
	});
});

// ─── configSnapshot — serialization invariant ───────────────────────────────

describe('configSnapshot', () => {
	it('includes all five namespaces', () => {
		const snap = configSnapshot();
		expect(snap).toHaveProperty('atmosphere');
		expect(snap).toHaveProperty('camera');
		expect(snap).toHaveProperty('director');
		expect(snap).toHaveProperty('world');
		expect(snap).toHaveProperty('shell');
	});

	it('produces plain JSON-cloneable data (no getters, no functions)', () => {
		const snap = configSnapshot();
		expect(() => JSON.parse(JSON.stringify(snap))).not.toThrow();
	});

	it('reflects a mutation applied via applyConfigPatch', () => {
		const orig = shell.blindOpen;
		applyConfigPatch('shell.blindOpen', !orig);
		const snap = configSnapshot();
		expect((snap.shell as { blindOpen: boolean }).blindOpen).toBe(!orig);
		applyConfigPatch('shell.blindOpen', orig);
	});

	it('clones nested objects so subsequent reactive mutations do not leak in', () => {
		const before = configSnapshot();
		const beforeDensity = (before.atmosphere as { clouds: { density: number } }).clouds.density;
		const next = beforeDensity > 0.5 ? 0.1 : 0.9;
		applyConfigPatch('atmosphere.clouds.density', next);
		// snapshot taken before should still hold the prior value
		expect((before.atmosphere as { clouds: { density: number } }).clouds.density).toBe(beforeDensity);
		applyConfigPatch('atmosphere.clouds.density', beforeDensity);
	});

	it('clones array fields (cloudDensityRange) so range tweaks do not leak in', () => {
		const snap = configSnapshot();
		const range = (snap.atmosphere as { weather: { cloudDensityRange: [number, number] } }).weather.cloudDensityRange;
		expect(Array.isArray(range)).toBe(true);
		expect(range.length).toBe(2);
		// mutate the snapshot copy and confirm the live state is untouched
		range[0] = -999;
		expect(atmosphere.weather.cloudDensityRange[0]).not.toBe(-999);
	});
});

// ─── Namespace isolation — applyConfigPatch must not leak across layers ───

describe('applyConfigPatch namespace isolation', () => {
	it('atmosphere.* writes do NOT touch camera', () => {
		const before = camera.orbit.driftRate;
		applyConfigPatch('atmosphere.clouds.density', atmosphere.clouds.density);
		expect(camera.orbit.driftRate).toBe(before);
	});

	it('director.* writes do NOT touch world', () => {
		const before = world.buildingsEnabled;
		applyConfigPatch('director.daylight.syncToRealTime', director.daylight.syncToRealTime);
		expect(world.buildingsEnabled).toBe(before);
	});

	it('world.hudVisible — nonexistent path rejected', () => {
		const ok = applyConfigPatch('world.hudVisible', true);
		expect(ok).toBe(false);
	});
});

// ─── CRDT -> reactive propagation integration ────────────────────────────

describe('applyConfigPatch reactive propagation', () => {
	it('mutates the $state namespace so consumers read the new value', () => {
		const original = atmosphere.clouds.density;
		applyConfigPatch('atmosphere.clouds.density', 0.42);
		expect(atmosphere.clouds.density).toBe(0.42);
		applyConfigPatch('atmosphere.clouds.density', original);
	});

	it('returns true when value unchanged (idempotency)', () => {
		const orig = atmosphere.clouds.density;
		expect(applyConfigPatch('atmosphere.clouds.density', orig)).toBe(true);
		expect(atmosphere.clouds.density).toBe(orig);
	});

	it('rejects type-mismatched patches', () => {
		const ok = applyConfigPatch('atmosphere.clouds.density', 'potato');
		expect(ok).toBe(false);
	});

	it('configSnapshot returns a deep copy (mutation-safe)', () => {
		const snap = configSnapshot();
		(snap.world as Record<string, unknown>).buildingsEnabled = !world.buildingsEnabled;
		expect(world.buildingsEnabled).not.toBe(
			(snap.world as Record<string, unknown>).buildingsEnabled,
		);
	});
});
