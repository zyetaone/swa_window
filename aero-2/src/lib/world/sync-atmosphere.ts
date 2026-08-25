import type { AtmosphereState } from '#lib/world/atmosphere.js';
import type { GlobeRuntime } from '#lib/world/runtime.js';

/** Per-frame atmosphere — fog today; sky/deck shaders land in later slices. */
export function syncAtmosphere(rt: GlobeRuntime, atmosphere: AtmosphereState): void {
	rt.viewer.scene.fog.density = atmosphere.fogDensity;
}
