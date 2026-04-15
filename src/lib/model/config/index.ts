/**
 * RootConfig — composed aggregate of all five layer configs.
 *
 * One WindowModel instance owns one RootConfig. Admin fleet pushes arrive
 * as `{ path: 'atmosphere.clouds.density', value: 0.7 }` and dispatch via
 * `rootConfig.applyPatch()` which splits on the first segment and delegates
 * to the layer's own `setPath()`.
 *
 * This is the foundation Phase 2–5 migrates consumers onto. The existing
 * flat fields on WindowModel stay in place during migration; removal is
 * deferred until every reader has been repointed at the config tree.
 */

export { WorldConfig } from './world.svelte';
export { AtmosphereConfig } from './atmosphere.svelte';
export { CameraConfig, type DeviceRole } from './camera.svelte';
export { DirectorConfig } from './director.svelte';
export { ChromeConfig } from './chrome.svelte';

import { WorldConfig } from './world.svelte';
import { AtmosphereConfig } from './atmosphere.svelte';
import { CameraConfig } from './camera.svelte';
import { DirectorConfig } from './director.svelte';
import { ChromeConfig } from './chrome.svelte';

export class RootConfig {
	world      = new WorldConfig();
	atmosphere = new AtmosphereConfig();
	camera     = new CameraConfig();
	director   = new DirectorConfig();
	chrome     = new ChromeConfig();

	/**
	 * Dispatch a path-targeted patch to the right layer.
	 * Returns true on success, false if the path wasn't recognized.
	 *
	 * Intended caller: fleet v2 `config_patch` message handler.
	 */
	applyPatch(path: string, value: unknown): boolean {
		const dot = path.indexOf('.');
		if (dot < 0) return false;
		const layer = path.slice(0, dot);
		const rest  = path.slice(dot + 1);
		switch (layer) {
			case 'world':      return this.world.setPath(rest, value);
			case 'atmosphere': return this.atmosphere.setPath(rest, value);
			case 'camera':     return this.camera.setPath(rest, value);
			case 'director':   return this.director.setPath(rest, value);
			case 'chrome':     return this.chrome.setPath(rest, value);
		}
		return false;
	}

	toJSON() {
		return {
			world:      this.world.toJSON(),
			atmosphere: this.atmosphere.toJSON(),
			camera:     this.camera.toJSON(),
			director:   this.director.toJSON(),
			chrome:     this.chrome.toJSON(),
		};
	}
}
