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
	configSnapshot,
	atmosphere,
	camera,
	director,
	world,
	shell,
	setAtmospherePath,
	setCameraPath,
	setDirectorPath,
	setWorldPath,
	setShellPath,
} from '$lib/model/config-tree.svelte';

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

describe('setByPath behaviour (via layer setters)', () => {
	it('returns false for a key that does not exist on the object', () => {
		const ok = setAtmospherePath('clouds.nonexistentField', 'x');
		expect(ok).toBe(false);
	});

	it('returns false when an intermediate segment is not an object', () => {
		// atmosphere.clouds.density is a number; can't descend into a number
		const ok = setAtmospherePath('clouds.density.foo', 1);
		expect(ok).toBe(false);
	});

	it('returns false for a nested path where the leaf key is missing', () => {
		const ok = setCameraPath('orbit.nope', 1);
		expect(ok).toBe(false);
	});

	it('writes the raw value without coercion (caller owns type validation)', () => {
		// setByPath is a low-level mutator — it does NOT validate value types.
		// Callers that need validation (fleet protocol) do so before calling.
		const original = shell.hudVisible;
		const ok = setShellPath('hudVisible', 'not-a-boolean' as unknown as boolean);
		expect(ok).toBe(true);
		expect(shell.hudVisible).toBe('not-a-boolean' as unknown as boolean);
		shell.hudVisible = original;
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
});

// ─── Per-layer setters — direct invocation (not via applyConfigPatch) ──────

describe('per-layer setters dispatch to correct namespace', () => {
	it('setAtmospherePath does NOT touch camera', () => {
		const before = camera.orbit.driftRate;
		setAtmospherePath('clouds.density', atmosphere.clouds.density);
		expect(camera.orbit.driftRate).toBe(before);
	});

	it('setDirectorPath does NOT touch world', () => {
		const before = world.buildingsEnabled;
		setDirectorPath('daylight.syncToRealTime', director.daylight.syncToRealTime);
		expect(world.buildingsEnabled).toBe(before);
	});

	it('setWorldPath rejects paths targeting shell fields', () => {
		const ok = setWorldPath('hudVisible', true);
		expect(ok).toBe(false);
	});
});
