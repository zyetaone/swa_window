import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tileTemplates } from '#lib/settings/tiles.js';
import { PaneSettings, KNOB_RANGE } from '#lib/settings/settings.svelte.js';

/**
 * Guards for bugs that have already shipped once and were re-broken by later
 * refactors. Each one cost a real debugging session, and comments alone did not
 * hold — the NAIP guard was removed three separate times.
 */

/**
 * Find a source file by name, wherever it currently lives under src/.
 *
 * Deliberately NOT a hardcoded path: this guard has already been silently
 * disabled once by a folder move (display/ → display/world/), which turned a
 * real regression check into an ENOENT. A guard that a refactor can switch off
 * by accident is not a guard.
 */
/** Every .svelte/.ts file under src/, for tree-wide invariants. */
function allSources(): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (/\.(svelte|ts)$/.test(entry)) out.push(full);
		}
	};
	walk('src');
	return out;
}

function findSource(fileName: string): string {
	const walk = (dir: string): string | null => {
		for (const entry of readdirSync(dir)) {
			const p = join(dir, entry);
			if (statSync(p).isDirectory()) {
				const hit = walk(p);
				if (hit) return hit;
			} else if (entry === fileName) {
				return p;
			}
		}
		return null;
	};

	const found = walk('src');
	if (!found) throw new Error(`${fileName} not found under src/ — was it renamed?`);
	return readFileSync(found, 'utf8');
}

describe('tile URL shape', () => {
	it('keeps the xyz/ segment and the file extension', () => {
		// The route matches `xyz/{layer}/{z}/{x}/{y}.{ext}` and uses it to flip x/y
		// into the on-disk WMTS layout. Drop either part and EVERY tile 404s.
		for (const [layer, tpl] of Object.entries(tileTemplates())) {
			expect(tpl[0], `${layer} must route through /api/tiles`).toContain('/api/tiles/');
			expect(tpl[0], `${layer} needs the xyz/ segment`).toContain('/xyz/');
			expect(tpl[0], `${layer} needs a file extension`).toMatch(/\.(jpg|png)$/);
		}
	});

	it('never names an upstream host - only api/tiles/+server.ts may do that', () => {
		for (const tpl of Object.values(tileTemplates()).flat()) {
			expect(tpl).not.toMatch(/amazonaws|earthdata|nationalmap/);
		}
	});
});

describe('GroundLayers', () => {
	it('unmounts the USGS source rather than fading it to zero', () => {
		// `raster-opacity: 0` hides a raster layer but does NOT stop it fetching.
		// Over Hyderabad (no NAIP coverage) that meant hundreds of 404s per second
		// for a layer nobody could see. A layer that renders nothing must not exist.
		const src = findSource('Ground.svelte');
		const usgsIndex = src.indexOf('id="usgs"');
		expect(usgsIndex, 'usgs source should exist').toBeGreaterThan(-1);

		const before = src.slice(0, usgsIndex);
		expect(
			before,
			'the usgs RasterTileSource must sit inside an {#if} on the detail opacity'
		).toMatch(/\{#if[^}]*etail[^}]*>\s*0\s*\}[\s\S]*$/);
	});
});

describe('the plane actually flies', () => {
	/**
	 * A restructure once deleted the frame loop and left `advanceTo()` with no
	 * caller. The view was computed once at construction and never again, so the
	 * window was a still photograph — while type-check, every unit test, the
	 * canvas mount and the console were all perfectly clean. Nothing but two
	 * screenshots five seconds apart could see it.
	 */
	it('drives the camera every frame from the flight pose', () => {
		const src = findSource('Stage.svelte');

		expect(src, 'something must schedule frames').toMatch(/requestAnimationFrame/);
		expect(src, 'each frame must advance the simulation clock').toMatch(/advanceTo\s*\(/);
		expect(src, 'each frame must move the MapLibre camera').toMatch(/jumpTo\s*\(/);
		expect(src, 'camera must be placed by real altitude, not a zoom level').toMatch(
			/calculateCameraOptionsFromTo/
		);
		expect(src, 'the loop must be cancelled on teardown').toMatch(/cancelAnimationFrame/);
	});

	it('does not let map controls fight the frame loop', () => {
		const src = findSource('Stage.svelte');

		// Both are overwritten by the very next frame, because the loop re-derives
		// the whole camera from the pose. Controls must change the params the pose
		// is computed FROM instead.
		expect(src, 'panBy is undone next frame — nudge azimuth instead').not.toMatch(/\.panBy\s*\(/);
		expect(src, 'bind:pitch fights the camera driver').not.toMatch(/bind:pitch/);
	});
});

describe('settings write gate', () => {
	/**
	 * `nudge('azimuthDeg')` wrapped into 0..360 while `applyUrl` and the slider
	 * both used -180..180. One press of "pan left" from the -90 default produced
	 * 255: a legal number, off the end of its own slider, and a different bearing
	 * convention from the one the URL uses. Two copies of a range disagreed.
	 */
	it('keeps azimuth in the same signed range the URL and slider use', () => {
		const s = new PaneSettings();
		s.azimuthDeg = -90;
		s.nudge('azimuthDeg', -15);
		expect(s.azimuthDeg).toBe(-105);

		s.azimuthDeg = -175;
		s.nudge('azimuthDeg', -20); // across the seam
		expect(s.azimuthDeg).toBeGreaterThanOrEqual(-180);
		expect(s.azimuthDeg).toBeLessThanOrEqual(180);
	});

	it('clamps every knob into its declared range', () => {
		const s = new PaneSettings();
		for (const key of Object.keys(KNOB_RANGE) as (keyof typeof KNOB_RANGE)[]) {
			const [lo, hi] = KNOB_RANGE[key];
			s.set(key, hi + 1000);
			expect(s[key], `${key} above max`).toBeLessThanOrEqual(hi);
			s.set(key, lo - 1000);
			expect(s[key], `${key} below min`).toBeGreaterThanOrEqual(lo);
		}
	});

	it('ignores NaN rather than poisoning the pose', () => {
		// A NaN knob makes the camera target NaN, which is a black screen with no
		// error — the same failure mode as the URL parser bug.
		const s = new PaneSettings();
		s.set('shade', Number.NaN);
		expect(Number.isFinite(s.shade)).toBe(true);
	});

	it('has no control anywhere binding straight into config', () => {
		// `bind:` skips the gate: no clamping now, and no validate/merge/broadcast
		// when fleet sync lands, so three panes desync silently. Scans the WHOLE
		// tree rather than one file — the previous version only checked
		// Settings.svelte, so a second panel could reintroduce it unnoticed.
		const offenders: string[] = [];
		for (const file of allSources()) {
			const src = readFileSync(file, 'utf8');
			if (/bind:(value|checked|group)=\{(display\.)?config\./.test(src)) offenders.push(file);
		}
		expect(offenders, 'controls must call config.set(), not bind: into config').toEqual([]);
	});
});

describe('privileged code stays unreachable until it is gated', () => {
	/**
	 * `server/update.ts` schedules `sudo -n systemctl start aero-updater.service`.
	 * aero-2 has no auth layer yet — no `$lib/http/auth`, no AERO_ADMIN_TOKEN
	 * handling — so an /api/update route would be a LAN-wide remote restart.
	 * v1's equivalent route calls `requireAdminToken(request)` first.
	 *
	 * This fails the moment a route imports it without an auth check, which is
	 * exactly the commit where someone would otherwise not think about it.
	 */
	it('no route imports the privileged updater without an auth gate', () => {
		const routes = allSources().filter((f) => f.includes('routes'));
		for (const file of routes) {
			const src = readFileSync(file, 'utf8');
			if (!/server\/update/.test(src)) continue;
			expect(
				/requireAdminToken|AERO_ADMIN_TOKEN/.test(src),
				`${file} runs privileged commands without an auth gate`
			).toBe(true);
		}
	});
});

describe('cloud sprites', () => {
	/**
	 * A THREE.Sprite applies scale in its OWN local axes, so a non-square sprite
	 * that also rotates gets sheared: at 1.3 x 1.0 the apparent aspect runs 1.30
	 * at 0 deg, 1.00 at 45 and 0.77 at 90. The mid-level clouds took a random
	 * full-circle rotation with a 1.3 stretch, so the same square texture
	 * rendered wide, round or squashed purely by its random angle.
	 *
	 * The rule: free rotation OR a stretch, never both. Horizon banks may
	 * stretch because they hold a near-zero roll.
	 */
	it('does not combine a full-circle rotation with a stretched scale', () => {
		const src = findSource('Clouds.svelte');

		// Any sprite scale where x and y differ, other than the horizon banks.
		const stretched = [...src.matchAll(/sprite\.scale\.set\(([^)]*)\)/g)]
			.map((m) => m[1].trim())
			.filter((args) => !args.includes('bankStretch'))
			.filter((args) => {
				const [x, y] = args.split(',').map((a) => a.trim());
				return x !== y;
			});

		expect(stretched, 'freely-rotating cloud sprites must be square').toEqual([]);
	});
});

describe('fog mapping', () => {
	/**
	 * `fog-ground-blend` was `clamp(fogDensity * 2400, 0.65, 0.95)`. Four of the
	 * five bands multiplied out below 0.65, so they were all pinned to the same
	 * value and only the mid deck rose above it — near-constant haze at every
	 * altitude. A high floor here silently erases the whole band model.
	 */
	it('does not floor the fog blend into permanent haze', () => {
		const src = findSource('Sky.svelte');
		const floors = [...src.matchAll(/Math\.max\(\s*([0-9.]+)\s*,/g)]
			.map((m) => Number(m[1]))
			.filter((n) => n > 0.4 && n < 1);
		expect(floors, 'a fog floor above 0.4 hides the altitude bands').toEqual([]);
	});
});

describe('engine decoupling', () => {
	it('supports switching 3D engines in PaneSettings', () => {
		const p = new PaneSettings();
		expect(p.engine).toBe('maplibre');

		p.engine = 'cesium';
		expect(p.engine).toBe('cesium');

		p.reset();
		expect(p.engine).toBe('maplibre');
	});
});

describe('the clamp table is the only range', () => {
	/**
	 * Four sliders carried hardcoded bounds that disagreed with KNOB_RANGE:
	 * speed [0.2,25] vs [0.1,25], exaggeration [0.2,6] vs [0.1,6], and both
	 * wing offsets [-500,500] vs [-800,800]. KNOB_RANGE is what `config.set`
	 * clamps to, so the UI simply could not reach legal values -- a settings
	 * table that is the SSOT for clamping but not for the control is only half
	 * an SSOT.
	 *
	 * Scans for a literal min=/max= on any input whose oninput calls
	 * config.set(), rather than checking the four known ones, so a fifth
	 * cannot be added with hardcoded bounds.
	 */
	it('no slider hardcodes bounds for a knob KNOB_RANGE already defines', () => {
		const src = readFileSync('src/lib/settings/Settings.svelte', 'utf8');
		const offenders: string[] = [];
		const inputs = src.match(/<input\b[\s\S]{0,500}?\/>/g) ?? [];
		for (const input of inputs) {
			const key = /config\.set\('(\w+)'/.exec(input)?.[1];
			if (!key || !(key in KNOB_RANGE)) continue;
			if (/min="[-\d.]+"/.test(input) || /max="[-\d.]+"/.test(input)) offenders.push(key);
		}
		expect(offenders, 'bind min/max to KNOB_RANGE instead of retyping them').toEqual([]);
	});
});

describe('runtime imports are declared dependencies', () => {
	/**
	 * `import('cesium')` shipped while `cesium` was absent from package.json.
	 * The build still succeeded — a dynamic import is resolved at RUNTIME, so
	 * neither `bun run build` nor `svelte-check` can see the gap, and it only
	 * fails on a machine that does not happen to have the package lying around
	 * in node_modules. Measured on ?engine=cesium: 1 uncaught exception.
	 *
	 * Any bare-specifier dynamic import must therefore be a declared dependency.
	 */
	it('every dynamically imported package is in package.json', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
		const declared = new Set([
			...Object.keys(pkg.dependencies ?? {}),
			...Object.keys(pkg.devDependencies ?? {})
		]);

		const undeclared = new Set<string>();
		for (const file of allSources()) {
			const src = readFileSync(file, 'utf8');
			for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
				const spec = m[1];
				// Relative paths and subpath aliases resolve locally.
				if (spec.startsWith('.') || spec.startsWith('#') || spec.startsWith('$')) continue;
				const pkgName = spec.startsWith('@')
					? spec.split('/').slice(0, 2).join('/')
					: spec.split('/')[0];
				if (!declared.has(pkgName)) undeclared.add(`${pkgName} (${file})`);
			}
		}

		expect(
			[...undeclared],
			'a dynamic import of an undeclared package builds fine and fails on a clean install'
		).toEqual([]);
	});
});

describe('three panes stay in step', () => {
	/**
	 * Three Pi 5s form ONE window and exchange nothing about what they draw, so
	 * every visible effect has to be a pure function of the wall clock. A single
	 * `Math.random()` in a render path splits the wall: the director rolled its
	 * own rotation interval and put three cities on three panes, and the storm
	 * lightning rolled its own delay and flashed at three different moments.
	 *
	 * Audio is exempt — it is one speaker, not three panes — and comments are
	 * not code.
	 */
	it('has no Math.random in anything that draws', () => {
		const offenders: string[] = [];
		for (const file of allSources()) {
			if (file.includes('/media/')) continue; // audio noise buffer, not visual
			const src = readFileSync(file, 'utf8');
			// strip block and line comments before looking
			const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
			if (/Math\.random\s*\(/.test(code)) offenders.push(file);
		}
		expect(offenders, 'use slotNoise/daySeed — a random draw desyncs the wall').toEqual([]);
	});
});
