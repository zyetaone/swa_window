/**
 * Config re-exports — v2 flat reactive config is now the authority.
 * Kept for any remaining imports from '$lib/model/config'.
 */

export { config, applyConfigPatch, configSnapshot } from './v2.svelte';
export type { CameraConfig, DirectorConfig } from './v2.svelte';
export { camera, director, atmosphere, world, shell } from './v2.svelte';
export type { DeviceRole } from './v2.svelte';
