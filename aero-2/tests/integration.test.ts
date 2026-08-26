/**
 * Integration assertions — the seams, not the units.
 *
 * The unit suite is healthy and was green through every failure it should have
 * caught. That is not a paradox: each component passed its own test while the
 * JOIN between components was broken. The DEM was packed correctly, served
 * correctly and decoded correctly by hand, yet the map read sea level. The
 * Sentinel-2 warp exited 0 and wrote nothing. The Cesium engine had a settings
 * field, a switch and a component, and no dependency.
 *
 * Everything here therefore asserts a property that spans a boundary, and each
 * one is written against a failure that actually happened.
 */
import { describe, it, expect, vi } from 'vitest';
import {
	existsSync,
	openSync,
	readSync,
	closeSync,
	readFileSync,
	readdirSync,
	statSync
} from 'node:fs';
import { join } from 'node:path';
import { calculateCameraView } from '#lib/display/flight/view.js';
import { resolveAtmosphere } from '#lib/display/world/atmosphere.js';
import { sunPosition, nightFactor } from '#lib/display/world/sun.js';
import { daySeed } from '#lib/display/flight/flight-path.js';
import { Location } from '#lib/settings/locations.js';
import { tileTemplates, TILE_MAXZOOM } from '#lib/settings/tiles.js';
import { remoteTileUrl } from '#lib/server/tiles.js';

/** Comments name these hazards to explain them; only real code counts. */
function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function simSources(): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (/\.(ts|svelte)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
		}
	};
	walk('src/lib/display');
	walk('src/lib/settings');
	return out;
}

// ── 1. The product invariant ─────────────────────────────────────────────────

/**
 * Three Pi 5s stand side by side and exchange nothing. The panorama only holds
 * if the entire world is a pure function of (wall clock, place, daySeed) — so
 * two independently built panes fed identical inputs must agree exactly, not
 * approximately.
 *
 * This is asserted over a whole climb cycle rather than at one instant, because
 * the ways it breaks are cumulative: an accumulator that integrates `dt`, or a
 * value seeded from boot time, agrees on the first frame and diverges later.
 * That is exactly how the cloud deck drifted apart — it was seeded per pane and
 * its rotation was `+=` off `performance.now()`, so panes agreed at a glance
 * and disagreed after an hour of uptime.
 */
describe('the world is a pure function of (wallclock, place, daySeed)', () => {
	const paramsFor = (place: Location) => ({
		place: {
			lat: place.lat,
			lon: place.lon,
			utcOffset: place.utcOffset,
			isFeature: place.isFeature
		},
		azimuthDeg: 0,
		pitchDeg: -18,
		floorM: place.climbFloorM,
		ceilingM: place.climbCeilingM,
		direction: 1 as const,
		phase: daySeed(place) * Math.PI * 2,
		speed: 4.0
	});

	it('two independently built panes agree exactly across a full cycle', () => {
		for (const place of Location.all()) {
			const a = paramsFor(place);
			const b = paramsFor(place);

			for (let s = 0; s < 3600; s += 37) {
				const va = calculateCameraView(s, a);
				const vb = calculateCameraView(s, b);
				expect(vb, `${place.id} diverged at t=${s}s`).toEqual(va);
			}
		}
	});

	/**
	 * The view for a given wall-clock second must not depend on WHEN it is
	 * computed.
	 *
	 * The first draft of this test asserted `sunPosition(s, ...)` equalled
	 * `sunPosition(s, ...)` — a call compared to itself, which passes for any
	 * deterministic body and proves nothing. The property that actually matters
	 * is that no ambient clock leaks in: three panes evaluate the same second at
	 * three slightly different real instants, and a stray `Date.now()` anywhere
	 * in the chain would make them disagree.
	 *
	 * `Location.utcOffset` deliberately reads the current instant, because DST
	 * is a function of today's date — so the two probes sit a minute apart,
	 * inside any DST regime, where a correct implementation cannot differ and a
	 * leaky one must.
	 */
	it('does not depend on when it is evaluated', () => {
		const AT = Date.UTC(2026, 6, 15, 12, 0, 0);
		vi.useFakeTimers();
		try {
			for (const place of Location.all()) {
				vi.setSystemTime(AT);
				const early = [0, 917, 4321].map((s) => ({
					view: calculateCameraView(s, paramsFor(place)),
					sun: sunPosition(s, place.lat, place.utcOffset)
				}));

				vi.setSystemTime(AT + 60_000);
				const late = [0, 917, 4321].map((s) => ({
					view: calculateCameraView(s, paramsFor(place)),
					sun: sunPosition(s, place.lat, place.utcOffset)
				}));

				expect(late, `${place.id} reads an ambient clock`).toEqual(early);
			}
		} finally {
			vi.useRealTimers();
		}
	});

	/**
	 * Night and atmosphere are the two curves the whole look hangs off, so pin
	 * their SHAPE rather than re-deriving them: midnight must be fully night,
	 * midday fully day, and the sky must darken monotonically as it climbs.
	 * A tautology here would hide a constant.
	 */
	it('keeps the night and atmosphere curves the right way up', () => {
		expect(nightFactor(0)).toBeCloseTo(1, 2);
		expect(nightFactor(12)).toBeCloseTo(0, 2);
		expect(nightFactor(0)).toBeGreaterThan(nightFactor(6));

		const luma = (agl: number) => {
			const [r, g, b] = resolveAtmosphere(agl).skyTop;
			return r + g + b;
		};
		expect(luma(11_000)).toBeLessThan(luma(500));
	});

	/**
	 * `Math.random()` and `+= dt` are the two shapes that split the wall, and
	 * neither is visible to the assertions above — they live in canvas render
	 * loops and timers, not in the view DTO. A source scan is the only thing
	 * that sees them, and it is the same technique regressions.test.ts already
	 * uses for upstream hosts, `bind:` into config and privileged imports.
	 *
	 * ALLOWED is for randomness that is genuinely per-pane and cosmetic: audio
	 * noise is not visual at all, and rain droplets on the glass are foreground
	 * cabin detail rather than shared world.
	 *
	 * It briefly carried a KNOWN list too, for director.svelte.ts, which rolled
	 * an unseeded 2-5 minute timer and advanced the DESTINATION on it. That debt
	 * is paid — the destination is derived from the wall clock now — so the list
	 * is gone rather than kept empty against future use.
	 */
	const ALLOWED = [
		'display/media/ambient-audio.ts', // white-noise buffer; audio, not world
		'display/cabin/RainGlass.svelte' // droplets on this pane's own glass
	];

	it('has no unseeded randomness in the simulation path', () => {
		const offenders: string[] = [];
		for (const file of simSources()) {
			const rel = file.replace(/^src\/lib\//, '');
			if (ALLOWED.some((a) => rel.endsWith(a))) continue;
			const src = readFileSync(file, 'utf8');
			// A comment naming the hazard is how this codebase documents it.
			const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
			if (/Math\.random\s*\(/.test(code)) offenders.push(rel);
		}
		expect(offenders, 'seed from daySeed, or add to ALLOWED with a reason').toEqual([]);
	});
});

/**
 * Two invariants ARCHITECTURE.md states and nothing enforced.
 *
 * Both were violated in the tree the day this was written, and neither showed
 * up in a unit test, because both are properties of where code lives rather
 * than of what any function returns. The source scan above already proved the
 * technique works for `Math.random`.
 */
describe('the architecture invariants are actually held', () => {
	/**
	 * Invariant 2: wall-clock time is the only input to the world, so three
	 * panes agree without a protocol.
	 *
	 * `Math.random` is the obvious half and is covered above. The other half is
	 * an accumulator: `x += dt` integrates each pane's own frame drops, and a
	 * clamp like `Math.min(0.1, dt)` silently discards the overflow, so the
	 * value runs slower than the clock by an amount that differs per pane and
	 * resets on reboot. That is how the director split the wall, and the cloud
	 * deck was doing it in three places while its own docstring claimed
	 * determinism. Derive from `view.wallSec` instead.
	 */
	it('integrates no frame deltas in the simulation path', () => {
		const offenders: string[] = [];
		for (const file of simSources()) {
			const rel = file.replace(/^src\/lib\//, '');
			const code = stripComments(readFileSync(file, 'utf8'));
			// `foo += dt`, `foo += delta * n`, `foo += elapsed`, and friends.
			const m = /(\w+)\s*\+=\s*[^;\n]*\b(dt|delta|deltaMs|elapsed|frameTime)\b/.exec(code);
			if (m) offenders.push(`${rel} (${m[0].trim()})`);
		}
		expect(offenders, 'derive from view.wallSec, not from an accumulator').toEqual([]);
	});

	/**
	 * Invariant 4, in the form that is actually true and worth enforcing.
	 *
	 * The doc claimed "only display/world/ imports MapLibre", which was never
	 * so -- MiniMap renders a map and needs one, and LookControls mounts a
	 * MapLibre control. Contorting those buys nothing.
	 *
	 * What does matter is that the PURE modules stay pure: the flight model,
	 * the camera, the atmosphere and the sun are the layer a second renderer
	 * has to reuse unchanged, and they are the layer the tests can exercise
	 * without a GPU. One renderer import in any of them and both properties are
	 * gone, which is how a "swappable engine" quietly stops being swappable.
	 */
	const PURE_MODULES = [
		'src/lib/display/flight/flight-path.ts',
		'src/lib/display/flight/view.ts',
		'src/lib/display/flight/parallax.ts',
		'src/lib/display/world/atmosphere.ts',
		'src/lib/display/world/sun.ts',
		'src/lib/settings/settings.svelte.ts',
		'src/lib/settings/locations.ts'
	];

	it('keeps the pure simulation modules free of any renderer', () => {
		const offenders: string[] = [];
		for (const file of PURE_MODULES) {
			const code = stripComments(readFileSync(file, 'utf8'));
			// `import type` is erased at build time and costs nothing at runtime.
			for (const line of code.split('\n')) {
				if (!/^\s*import\s/.test(line) || /^\s*import\s+type\s/.test(line)) continue;
				if (/'(maplibre-gl|svelte-maplibre-gl|cesium|three)/.test(line))
					offenders.push(`${file}: ${line.trim()}`);
			}
		}
		expect(offenders, 'the pure layer is what a second renderer reuses').toEqual([]);
	});
});

// ── 2. The elevation pipeline ────────────────────────────────────────────────

/**
 * PMTiles v3 header: bounds live at fixed offsets as int32 micro-degrees, and
 * the zoom range as two bytes. Parsed directly rather than pulling in a reader,
 * because 24 bytes at known offsets is not worth a dependency.
 */
function readPmtilesHeader(path: string) {
	const fd = openSync(path, 'r');
	const buf = Buffer.alloc(127);
	readSync(fd, buf, 0, 127, 0);
	closeSync(fd);
	if (buf.subarray(0, 7).toString() !== 'PMTiles')
		throw new Error(`${path} is not a PMTiles archive`);
	return {
		version: buf.readUInt8(7),
		minzoom: buf.readUInt8(100),
		maxzoom: buf.readUInt8(101),
		minLon: buf.readInt32LE(102) / 1e7,
		minLat: buf.readInt32LE(106) / 1e7,
		maxLon: buf.readInt32LE(110) / 1e7,
		maxLat: buf.readInt32LE(114) / 1e7
	};
}

/**
 * `/data` is gitignored, so this cannot be a hard requirement — a test that
 * reads data/** passes locally and takes the deploy gate red, which has
 * happened before. Skipped with a message rather than silently, so a skip in
 * CI is legible and a skip on a workstation is a prompt to build the archive.
 */
describe('the packed DEM covers every location that needs it', () => {
	const ARCHIVE = 'static/tiles/terrain.pmtiles';
	const present = existsSync(ARCHIVE);

	it.skipIf(!present)('reaches every location in the catalog', () => {
		const h = readPmtilesHeader(ARCHIVE);

		// The orbit is ~47 km across and the view reaches well past it, so the
		// centre alone is not enough — require a degree of margin on each side.
		const MARGIN_DEG = 1.0;
		const missing = Location.all()
			.filter(
				(l) =>
					l.lon - MARGIN_DEG < h.minLon ||
					l.lon + MARGIN_DEG > h.maxLon ||
					l.lat - MARGIN_DEG < h.minLat ||
					l.lat + MARGIN_DEG > h.maxLat
			)
			.map((l) => `${l.id} (${l.lat.toFixed(2)}, ${l.lon.toFixed(2)})`);

		// The Himalayas sat at 86.9E against an archive that stopped at 79.9E,
		// so the DEM was simply absent there and the window showed no relief.
		// It looked like a rendering bug for hours. It was a packaging gap, and
		// this is the one line that would have said so.
		expect(missing, `outside archive bounds — repack: bun tools/pack-pmtiles.ts terrarium`).toEqual(
			[]
		);
	});

	it.skipIf(!present)('declares the zoom range the runtime asks for', () => {
		const h = readPmtilesHeader(ARCHIVE);
		expect(h.version).toBe(3);
		// A source that requests beyond the archive gets tiles that never
		// resolve, and MapLibre reports missing elevation as 0 — which is
		// indistinguishable from sea level at the call site.
		expect(h.maxzoom).toBe(TILE_MAXZOOM.terrarium);
		expect(h.minzoom).toBeLessThanOrEqual(5);
	});
});

// ── 3. Every source the style names must be one the server can answer ────────

/**
 * `Ground.svelte` mounts sources from `tileTemplates()`; the server answers
 * them in `remoteTileUrl`. Nothing tied the two together, so a layer could name
 * a slug the server had never heard of and the only symptom would be tiles that
 * quietly never arrive — which is exactly how an invisible USGS layer streamed
 * 404s by the hundred over Hyderabad.
 */
describe('every tile source the client names, the server can serve', () => {
	it('resolves each template slug to an upstream URL', () => {
		const templates = tileTemplates();
		for (const [slug, urls] of Object.entries(templates)) {
			expect(urls.length, `${slug} has no template`).toBeGreaterThan(0);

			// The client asks in xyz form and the server answers in WMTS form;
			// the extension has to survive that hop, so take it from the
			// template the client actually mounts rather than assuming one.
			const ext = /\.(jpg|jpeg|png)$/.exec(urls[0])?.[1];
			expect(ext, `${slug} template declares no image extension`).toBeTruthy();

			const built = remoteTileUrl(`${slug}/4/3/2.${ext}`);
			expect(built, `server cannot resolve slug "${slug}"`).toBeTruthy();
			expect(built, `"${slug}" must resolve to an absolute upstream`).toMatch(/^https?:\/\//);
		}
	});

	it('declares a maxzoom for every slug it serves', () => {
		for (const slug of Object.keys(tileTemplates())) {
			expect(
				TILE_MAXZOOM[slug as keyof typeof TILE_MAXZOOM],
				`${slug} has no declared maxzoom, so the client will overzoom into 404s`
			).toBeGreaterThan(0);
		}
	});
});
