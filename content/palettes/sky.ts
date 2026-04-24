/**
 * Sky palette — per-skyState visual tuning for DOM/CSS overlays.
 *
 * Each entry gives:
 *   background — full-viewport gradient behind the Cesium canvas
 *                (rendered by shell/Window.svelte, shown through the glass)
 *   haze       — horizon haze color + alpha (rendered by atmosphere/haze)
 *
 * Authored content. A curator can cool the dawn sky or warm dusk without
 * touching component code.
 *
 * NOTE — there's a THIRD color surface that isn't in this file:
 * `src/lib/world/shaders.ts` holds a GLSL string constant with numeric
 * rgb() mix calls for the horizon-haze post-process. Keeping the shader
 * numerics in sync with this palette is still manual. If a future change
 * wires the shader uniforms to these constants, this comment comes out.
 */

import type { SkyState } from '$lib/types';

export interface SkyPaletteEntry {
	/** CSS background — usually a linear-gradient. */
	background: string;
	/** CSS color (rgba recommended) for horizon haze overlay. */
	haze: string;
}

export const SKY_PALETTE: Record<SkyState, SkyPaletteEntry> = {
	night: {
		background: 'linear-gradient(180deg, #0a0a1e 0%, #1a1a2e 50%, #0d0d20 100%)',
		haze: 'rgba(20, 28, 50, 0.55)', // deep navy — screen blend preserves stars
	},
	dawn: {
		background: 'linear-gradient(180deg, #1a1a3a 0%, #4a3060 30%, #d08060 70%, #e0a070 100%)',
		haze: 'rgba(220, 150, 110, 0.22)', // warm amber
	},
	dusk: {
		background: 'linear-gradient(180deg, #1a1a3a 0%, #503050 30%, #c07050 70%, #d09060 100%)',
		haze: 'rgba(200, 110, 90, 0.24)', // warm coral
	},
	day: {
		background: 'linear-gradient(180deg, #4a7ab5 0%, #6a9ad0 40%, #8cb8e0 70%, #a0c8e8 100%)',
		haze: 'rgba(170, 195, 220, 0.18)', // cool atmospheric blue
	},
};
