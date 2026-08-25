/**
 * Globe lighting follows the night factor.
 */
import type { GlobeRuntime, Subsystem, WorldFrame } from '#lib/world/contract.js';
import { EpsilonGate } from '#lib/utils.js';

export class LightingSync implements Subsystem {
	readonly #gate = new EpsilonGate(0.005);

	sync(rt: GlobeRuntime, frame: WorldFrame): void {
		const nightFactor = frame.nightFactor;
		if (!this.#gate.changed(nightFactor)) return;
		rt.viewer.scene.globe.enableLighting = nightFactor > 0.05;
	}

	reset(): void {
		this.#gate.reset();
	}
}
