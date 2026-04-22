/**
 * Static-asset manifest for the Pi offline bundle.
 *
 * The tile-packager's primary job is XYZ map tiles, but the Pi deployment
 * also needs a handful of non-tile static assets that the app references
 * at runtime (cloud sprites, water normal map, sky textures, night overlay
 * assets, optional color LUTs). Those assets live in `static/` and are
 * served by SvelteKit in the build, but for a true offline-first deploy
 * we copy them into the same packaged output directory so `scp <out> pi:`
 * delivers everything the kiosk needs in one payload.
 *
 * Paths are relative to the repo root. The packager reads these from the
 * source tree at build time — not fetched over the network.
 */

export interface StaticAsset {
	/**
	 * Logical category — drives the per-asset cap in the estimator and the
	 * summary printout. Not used for anything else.
	 */
	category: 'water' | 'clouds' | 'sky' | 'night' | 'lut';
	/** Repo-relative source path (read by packager at build time). */
	source: string;
	/**
	 * Destination path under the tile output dir. The Pi serves the whole
	 * output dir statically, so these paths are the URL paths too.
	 */
	dest: string;
	/**
	 * If true, the asset is optional — a missing source file logs a warning
	 * but does not fail the packager run. Used for files that are generated
	 * by sibling agents (water-shader) and may not yet exist.
	 */
	optional?: boolean;
}

/**
 * The manifest. Keep this list small and explicit — every entry should
 * correspond to something the app actually references from `static/`.
 */
export const STATIC_ASSETS: readonly StaticAsset[] = [
	// ─── Water shader (water-shader agent drops this in static/textures/) ──
	{
		category: 'water',
		source: 'static/textures/water-normals.jpg',
		dest: 'static/textures/water-normals.jpg',
		// The water-shader agent generates the small variant asynchronously.
		// We still bundle the main one; the small variant (if present) is
		// picked up by the fd-glob pass below.
		optional: false,
	},

	// ─── CSS3D cloud sprites (bundled CC0 PNGs) ────────────────────────────
	{ category: 'clouds', source: 'static/cloud.png',          dest: 'static/cloud.png' },
	{ category: 'clouds', source: 'static/cloud-dark.png',     dest: 'static/cloud-dark.png' },
	{ category: 'clouds', source: 'static/cloud-smoke.png',    dest: 'static/cloud-smoke.png' },
	{ category: 'clouds', source: 'static/cloud-01.png',       dest: 'static/cloud-01.png',  optional: true },
	{ category: 'clouds', source: 'static/cloud-03.png',       dest: 'static/cloud-03.png',  optional: true },
	{ category: 'clouds', source: 'static/cloud-05.png',       dest: 'static/cloud-05.png',  optional: true },
	{ category: 'clouds', source: 'static/cloud-07.png',       dest: 'static/cloud-07.png',  optional: true },
	{ category: 'clouds', source: 'static/textures/cloud-detail.png', dest: 'static/textures/cloud-detail.png' },
	{ category: 'clouds', source: 'static/textures/cloud-noise.png',  dest: 'static/textures/cloud-noise.png' },

	// ─── Sky textures (NightOverlay backdrops — CC-BY NASA/ESA, free reuse) ─
	{ category: 'sky',   source: 'static/sky/andromeda.jpg',    dest: 'static/sky/andromeda.jpg',   optional: true },
	{ category: 'sky',   source: 'static/sky/hubble-deep.jpg',  dest: 'static/sky/hubble-deep.jpg', optional: true },
	{ category: 'sky',   source: 'static/sky/orion.jpg',        dest: 'static/sky/orion.jpg',       optional: true },

	// ─── Night / weather overlays ──────────────────────────────────────────
	{ category: 'night', source: 'static/textures/weather-map.png', dest: 'static/textures/weather-map.png', optional: true },

	// ─── Optional SWA brand LUT (only bundled if the .cube file exists) ─────
	// No file committed yet. The packager will skip silently if absent.
	{ category: 'lut',   source: 'static/luts/swa-brand.cube',  dest: 'static/luts/swa-brand.cube',  optional: true },
] as const;

/**
 * Categorised counters for the summary printout.
 */
export type AssetCategory = StaticAsset['category'];
