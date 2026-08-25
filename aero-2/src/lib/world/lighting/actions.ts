/**
 * Globe lighting follows the night factor.
 */
import type { GlobeRuntime, Subsystem, RenderFrame } from '#lib/cesium/types.js';
import { EpsilonGate } from '#lib/cesium/gate.js';

export class LightingSync implements Subsystem {
	readonly #gate = new EpsilonGate(0.005);

	sync(rt: GlobeRuntime, frame: RenderFrame): void {
		const nightFactor = frame.nightFactor;
		if (!this.#gate.changed(nightFactor)) return;
		rt.viewer.scene.globe.enableLighting = nightFactor > 0.05;
	}

	reset(): void {
		this.#gate.reset();
	}
}
