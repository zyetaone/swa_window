/**
 * Trades tessellation detail for altitude — the ground is only worth
 * resolving when you can see it.
 */
import type { GlobeRuntime, Subsystem, RenderFrame } from '#lib/render/types.js';
import { SSE_CRUISE, SSE_GROUND } from '#lib/assets/data/imagery.js';
import { EpsilonGate } from '#lib/render/gate.js';

const SSE_HYSTERESIS = 2;

export function screenSpaceErrorFor(groundDetail: number): number {
	const g = Number.isFinite(groundDetail) ? Math.min(1, Math.max(0, groundDetail)) : 0;
	return SSE_CRUISE + (SSE_GROUND - SSE_CRUISE) * g;
}

export class LodSync implements Subsystem {
	readonly #gate = new EpsilonGate(SSE_HYSTERESIS);

	sync(rt: GlobeRuntime, frame: RenderFrame): void {
		const target = screenSpaceErrorFor(frame.atmosphere.groundDetail);
		if (!this.#gate.changed(target)) return;
		rt.viewer.scene.globe.maximumScreenSpaceError = target;
	}

	reset(): void {
		this.#gate.reset();
	}
}
