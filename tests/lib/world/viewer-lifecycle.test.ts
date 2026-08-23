/**
 * Coverage for the viewer teardown contract.
 *
 * The `world/` modules are module-level singletons; the VIEWER is not. Every
 * handle captured against a viewer that Cesium later replaces (auto-retry,
 * HMR, page nav) is either attached to a destroyed scene or lying about what
 * the live scene contains — and none of it throws. The globe renders bare, or
 * the skyline never appears, or a gate reports "unchanged" forever.
 *
 * Four separate occurrences: the Ion tileset, the imagery layers, the
 * EpsilonGates, the offline building cache.
 *
 * Every previous fix was a comment plus per-module discipline, and the next
 * omission slipped through anyway — because teardown lived in two conventions
 * (explicit destroyX vs reset-inside-initX) and new state could belong to
 * neither. This test is the enforcement that the comments were not: it scans
 * for viewer-scoped state and fails when it is not registered.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { registeredViewerTeardowns } from '$lib/world/viewer-lifecycle';

// Importing for side effects: registration happens at module scope, so a
// subsystem only appears in the registry once its module has been loaded.
import '$lib/world/imagery';
import '$lib/world/terrain';
import '$lib/world/buildings';
import '$lib/world/buildings-geojson';
import '$lib/world/roads-geojson';
import '$lib/world/atmosphere';
import '$lib/world/lightning-stage';
import '$lib/world/clouds/billboard-layer';

const DIR = 'src/lib/world';

/** Every .ts under `dir`, at any depth, as paths relative to the repo root. */
function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
	);
}

/**
 * Does this module hold state that belongs to one particular viewer?
 *
 * Heuristic, deliberately: mutable module-level state (a bare `let`, or a
 * const Map/Set/Array accumulated into) in a file that also deals in a Cesium
 * Viewer. That is the exact shape of all four historical bugs.
 */
function viewerScopedModules(): string[] {
	const out: string[] = [];
	// RECURSIVE. It used to be a flat readdirSync of world/, which meant the
	// contract silently stopped at the directory boundary: world/three/ has
	// never been checked by it, and colocating any guarded module into a
	// subfolder would have quietly dropped it from the scan while leaving this
	// file green. A guard that a `git mv` can disarm is the "reads as solved"
	// failure this suite exists to prevent, one level up.
	for (const file of walk(DIR)) {
		if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
		if (file.endsWith('viewer-lifecycle.ts')) continue;
		const src = readFileSync(file, 'utf8');
		// Opt-out, declared in the module itself rather than listed here, so the
		// reasoning sits where someone adding state will actually read it. Used
		// by cesium-setup, whose token + tile-probe answers are about the DEVICE
		// and must survive a viewer swap.
		if (/viewer-lifecycle:\s*tab-scoped/.test(src)) continue;
		const mutableModuleState =
			/^let\s/m.test(src) || /^const\s+_\w+\s*=\s*new\s+(Map|Set|Array|WeakMap)/m.test(src);
		const touchesViewer = /Viewer\b/.test(src);
		if (mutableModuleState && touchesViewer) out.push(file.slice(DIR.length + 1).replace(/\.ts$/, ''));
	}
	return out;
}

describe('every viewer-scoped world module is registered for teardown', () => {
	it('finds the modules it is supposed to be guarding', () => {
		// Guards the guard: if the heuristic ever matches nothing (a refactor,
		// a rename, a moved directory) the assertion below would pass
		// vacuously and this whole file would silently stop protecting.
		expect(viewerScopedModules().length).toBeGreaterThanOrEqual(5);
	});

	it('registers a teardown for each of them', () => {
		const registered = new Set(registeredViewerTeardowns());
		// Registry keys are subsystem names, not filenames, and a module may
		// register under a friendlier one ('cloud-billboard-layer' →
		// 'cloud-billboards'), so a prefix match either way counts as covered.
		const covered = (mod: string) =>
			registered.has(mod)
			|| [...registered].some((name) => mod.startsWith(name) || name.startsWith(mod));
		const missing = viewerScopedModules().filter((mod) => !covered(mod));
		expect(
			missing,
			`viewer-scoped world modules with no registered teardown: ${missing.join(', ')}. `
				+ 'Add registerViewerTeardown(name, resetFn) at module scope — see world/viewer-lifecycle.',
		).toEqual([]);
	});
});

describe('teardown is actually wired into the manager', () => {
	it('CesiumManager.destroy() calls it', () => {
		// A registry nothing invokes is worse than no registry: it reads as
		// solved. The previous code named two subsystems explicitly here, which
		// is how a third ended up cleared by nothing.
		const src = readFileSync('src/lib/world/compose.ts', 'utf8');
		const destroy = src.slice(src.indexOf('\tdestroy(): void {'));
		expect(destroy.slice(0, destroy.indexOf('\n\t}'))).toContain('teardownViewerState()');
	});

	it('no longer names individual subsystem destroys there', () => {
		const src = readFileSync('src/lib/world/compose.ts', 'utf8');
		expect(src).not.toContain('destroyLightning()');
		expect(src).not.toContain('destroyCesiumClouds()');
	});
});

describe('teardown is defensive', () => {
	it('one failing subsystem does not strand the others', async () => {
		// A half-torn-down world is exactly the bare-globe state this contract
		// exists to prevent, so a thrower must not abort the loop.
		const { registerViewerTeardown, teardownViewerState } = await import(
			'$lib/world/viewer-lifecycle'
		);
		let reached = false;
		registerViewerTeardown('__throws', () => {
			throw new Error('boom');
		});
		registerViewerTeardown('__after', () => {
			reached = true;
		});
		expect(() => teardownViewerState()).not.toThrow();
		expect(reached).toBe(true);
	});
});
