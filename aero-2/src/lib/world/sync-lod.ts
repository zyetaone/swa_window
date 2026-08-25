/**
 * Globe level-of-detail — one-time setup plus the per-frame detail swap.
 *
 * Two separate wins, both from the same observation. An oblique window view
 * sees to the horizon (~357 km at 10 km altitude) against ~11 km looking
 * straight down, so most of the frame is enormous ground area compressed into
 * very few pixels:
 *
 *   - fog.screenSpaceErrorFactor coarsens tiles by DISTANCE, so the far field
 *     stops paying for detail nobody can resolve. Set once.
 *   - maximumScreenSpaceError coarsens tiles by ALTITUDE, because at cruise
 *     the ground is a smear and the deck below is what fills the frame. Driven
 *     per-frame from the band model's groundDetail — the same single source
 *     that decides fog, deck opacity and sky.
 *
 * The altitude half is what "swap to less detailed textures when high" means
 * in practice: it changes which tiles Cesium selects, so it needs no alternate
 * tile source and works against whatever imagery is attached.
 */
import type { AtmosphereState } from '#lib/world/atmosphere.js';
import { SSE_GROUND, SSE_CRUISE, FOG_SSE_FACTOR } from '#content/quality/lod.js';
import { exceedsDeadband } from '#lib/utils.js';
import type { GlobeRuntime } from '#lib/world/runtime.svelte.js';

type Scene = import('cesium').Scene;

/** How far it must drift before stepping. Each change retiles the globe. */
const SSE_HYSTERESIS = 2;


export function setupLod(scene: Scene): void {
	scene.globe.maximumScreenSpaceError = SSE_GROUND;
	// Fog must be on for screenSpaceErrorFactor to apply — it is the fog
	// distance that drives the relaxation.
	scene.fog.enabled = true;
	scene.fog.screenSpaceErrorFactor = FOG_SSE_FACTOR;
}

/** Pure: ground legibility to tile error. */
export function screenSpaceErrorFor(groundDetail: number): number {
	const g = Number.isFinite(groundDetail) ? Math.min(1, Math.max(0, groundDetail)) : 0;
	return SSE_CRUISE + (SSE_GROUND - SSE_CRUISE) * g;
}

export class LodSync {
	#applied: number | null = null;

	sync(rt: GlobeRuntime, atmosphere: AtmosphereState): void {
		const target = screenSpaceErrorFor(atmosphere.groundDetail);
		if (!exceedsDeadband(this.#applied, target, SSE_HYSTERESIS)) return;
		this.#applied = target;
		rt.viewer.scene.globe.maximumScreenSpaceError = target;
	}

	reset(): void {
		this.#applied = null;
	}
}
