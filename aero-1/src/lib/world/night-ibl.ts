/**
 * night-ibl — OPT-IN image-based lighting for the buildings tileset.
 *
 * ─── STATUS: PROTOTYPE, OFF BY DEFAULT ──────────────────────────────────────
 * Nothing calls this yet. It exists so the night-lighting upgrade can be
 * evaluated by flipping one flag, rather than by editing `compose.ts` — which
 * AGENTS.md flags as high blast radius (every surface renders through it).
 * Enable with `world.useDynamicEnvironmentMap`, compare, then decide.
 *
 * ─── WHAT IT IS, AND WHAT IT IS *NOT* ───────────────────────────────────────
 * Cesium 1.125+ ships `DynamicEnvironmentMapManager`, which generates an
 * environment map on the GPU from the scene's CURRENT sun position and
 * atmosphere, then derives specular mipmaps + spherical-harmonic diffuse
 * irradiance from it. Tilesets expose one as `tileset.environmentMapManager`.
 *
 * ⚠ CORRECTION (found by probing the live scene, not by reading): this is
 * ALREADY ON. Cesium's own default is `enabled = true`, confirmed both in the
 * type docs (`@property [enabled = true]`) and by inspecting the running
 * tileset, which reported `enabled: true` before this module touched anything.
 * So the feature is not "unadopted" — what is unadopted is TUNING it for the
 * night case. This module therefore does not switch a capability on; it
 * retunes an already-active one.
 *
 * Verified present in the installed Cesium (1.143):
 *   Source/Cesium.d.ts → `export class DynamicEnvironmentMapManager`
 *   Cesium3DTileset    → `readonly environmentMapManager`
 *
 * ─── WHY IT MATTERS AT NIGHT SPECIFICALLY ───────────────────────────────────
 * Right now the OSM buildings are lit by one directional sun light plus the
 * custom emissive-window shader. After sunset the directional term goes to
 * ~nothing, so unlit building FACES fall to a flat ambient value and the
 * geometry reads as silhouettes with glowing dots stuck on them — the form
 * disappears. An environment map keeps a plausible sky/ground contribution
 * after the sun is down, so facades still catch the residual sky and the
 * skyline keeps its shape.
 *
 * `atmosphereScatteringIntensity` is the useful knob, and Cesium's default is
 * 2.0. Raising it increases the environment's contribution relative to the
 * (near-zero) direct sun, which is exactly the night case. `groundColor` tints
 * the bounce from below — a warm value approximates a lit city throwing light
 * back up at the buildings, which the stock neutral default does not.
 *
 * ─── COST, AND WHY IT IS GATED ──────────────────────────────────────────────
 * The map regenerates when the sun moves or the model moves "significantly",
 * spread over several frames. On a Pi 5 already fps-bound that is a real cost,
 * so this is gated to non-`performance` quality and throttled hard: the kiosk
 * only needs a new map as the sun crosses the sky, not every frame.
 */
import type * as CesiumType from 'cesium';

type C = typeof CesiumType;

/** Tuning for the night look. Deliberately narrow — see the header. */
interface NightIblOptions {
	/**
	 * Environment contribution relative to direct sun. Cesium's own example
	 * uses 3.0 to "increase the intensity of the environment map lighting
	 * contribution"; at night the direct term is ~0, so this is what keeps
	 * facades readable.
	 */
	atmosphereScatteringIntensity: number;
	/** Bounce colour from below — warm approximates a lit city. */
	groundColorCss: string;
	/** How much light the ground bounces back (0..1). */
	groundAlbedo: number;
	/** Seconds of simulated time before the map is regenerated. */
	maximumSecondsDifference: number;
}

const NIGHT_IBL_DEFAULTS: NightIblOptions = {
	atmosphereScatteringIntensity: 3.0,
	// Warm sodium bounce, matching the emissive-window palette family.
	groundColorCss: '#2a1d10',
	groundAlbedo: 0.28,
	// 10 simulated minutes. The sun barely moves in that time at 1× rate, and
	// the kiosk's time-of-day is often accelerated, so this bounds regeneration
	// without the map visibly lagging the sky.
	maximumSecondsDifference: 600,
};

/**
 * Attach dynamic IBL to a tileset. Idempotent and defensive: returns false
 * (changing nothing) when the running Cesium predates the API, so this cannot
 * break a device on an older build.
 */
export function enableNightIbl(
	Cesium: C,
	tileset: CesiumType.Cesium3DTileset | null,
	options: NightIblOptions = NIGHT_IBL_DEFAULTS,
): boolean {
	if (!tileset) return false;

	// `environmentMapManager` is readonly and only present on 1.125+.
	const mgr = (tileset as unknown as { environmentMapManager?: Record<string, unknown> })
		.environmentMapManager;
	if (!mgr || typeof mgr !== 'object') return false;

	mgr.enabled = true;
	mgr.atmosphereScatteringIntensity = options.atmosphereScatteringIntensity;
	mgr.groundAlbedo = options.groundAlbedo;
	mgr.maximumSecondsDifference = options.maximumSecondsDifference;
	try {
		mgr.groundColor = Cesium.Color.fromCssColorString(options.groundColorCss);
	} catch {
		// A bad CSS string must not take the scene down; the default colour is fine.
	}
	return true;
}

/**
 * Turn it back off — for A/B comparison without a reload.
 * Deliberate public API: half of the flag-flip evaluation this prototype
 * module exists for (see header); today only tests call it.
 */
export function disableNightIbl(tileset: CesiumType.Cesium3DTileset | null): boolean {
	if (!tileset) return false;
	const mgr = (tileset as unknown as { environmentMapManager?: Record<string, unknown> })
		.environmentMapManager;
	if (!mgr || typeof mgr !== 'object') return false;
	mgr.enabled = false;
	return true;
}

/**
 * Is the API available on this Cesium build? Deliberate public API: probe for
 * the flag-flip evaluation (see header) — enableNightIbl already no-ops
 * defensively, so the flag path never needs it; today only tests call it.
 */
export function nightIblSupported(tileset: CesiumType.Cesium3DTileset | null): boolean {
	if (!tileset) return false;
	const mgr = (tileset as unknown as { environmentMapManager?: unknown }).environmentMapManager;
	return !!mgr && typeof mgr === 'object';
}
