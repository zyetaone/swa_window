/**
 * Threlte Plugins for Aero Dynamic Window
 *
 * - turbulence: Adds motion noise to objects based on weather
 * - daynight: Auto-adjusts materials for day/night cycle
 * - selectiveBloom: Bloom effect only for specific layers
 */

export { turbulence, type TurbulenceProps } from './turbulence.svelte';
export { daynight, type DayNightProps } from './daynight.svelte';
export { setupSelectiveBloom, BLOOM_LAYER, type BloomOptions } from './selectiveBloom.svelte';
