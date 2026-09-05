/**
 * Sky palette — per-skyState visual tuning for DOM/CSS overlays.
 *
 * Each entry gives:
 *   background       — full-viewport gradient behind the Cesium canvas
 *                       (rendered by shell/Window.svelte, shown through the glass)
 *   haze             — horizon haze color + alpha (rendered by atmosphere/haze)
 *   filterBrightness — multiplies Cesium exposure (× weather recipe
 *                       filterBrightness in compose.ts → atmosphere.ts)
 *   glassVignette    — radial-gradient black overlay opacity at the rim
 *                       (passed to <Glass glassVignetteOpacity={...} />)
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
	/** Multiplier on Cesium post-process exposure (× weather filterBrightness). */
	filterBrightness: number;
	/** Radial-gradient black overlay opacity at the rim of the glass. Pane.svelte
	 *  passes this to <Glass glassVignetteOpacity={...} /> as a CSS variable. */
	glassVignette: number;
}

export const SKY_PALETTE: Record<SkyState, SkyPaletteEntry> = {
	night: {
		background: 'linear-gradient(180deg, #07071a 0%, #0d1030 40%, #121528 80%, #0a0d22 100%)',
		haze: 'rgba(20, 28, 55, 0.50)', // deep navy — screen blend preserves stars
		filterBrightness: 1.0,
		glassVignette: 0.15,
	},
	dawn: {
		background: 'linear-gradient(180deg, #0e1432 0%, #1d2f5e 22%, #8b3820 52%, #d47030 78%, #e89850 100%)',
		haze: 'rgba(235, 140, 60, 0.28)', // warm amber
		filterBrightness: 0.95,
		glassVignette: 0.1,
	},
	dusk: {
		// Deep blue zenith → indigo → rust-orange terminator → warm amber horizon.
		// No purple mid-tone — from altitude, dusk is a clean warm-to-deep-blue arc.
		background: 'linear-gradient(180deg, #0e1432 0%, #1a2550 22%, #7c2e18 52%, #c85e28 76%, #e07840 100%)',
		haze: 'rgba(240, 118, 45, 0.30)', // deep warm amber, screen blend adds glow
		filterBrightness: 0.95,
		glassVignette: 0.1,
	},
	day: {
		background: 'linear-gradient(180deg, #4a7ab5 0%, #6a9ad0 40%, #8cb8e0 70%, #a0c8e8 100%)',
		haze: 'rgba(170, 195, 220, 0.18)', // cool atmospheric blue
		filterBrightness: 1.0,
		glassVignette: 0.05,
	},
};
