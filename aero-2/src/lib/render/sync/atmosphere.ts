/**
 * Paints the band the aircraft is in.
 */
import type { GlobeRuntime, Subsystem, RenderFrame } from '#lib/render/types.js';
import { EpsilonGate } from '#lib/render/gate.js';

/**
 * Paints the band the aircraft is currently in: fog thickens with altitude and
 * the sky darkens toward the stratosphere.
 *
 * Gated on altitude rather than on each colour channel — every field in the
 * atmosphere state is a function of altitude alone, so one gate covers them all
 * and the three panes cross each threshold on the same value, not the same frame.
 *
 * `deckOpacity` is deliberately unread: it wants an actual cloud deck to fade,
 * and there isn't one yet. Wiring it to fog would double-count the haze.
 */
export class AtmosphereSync implements Subsystem {
	readonly #gate = new EpsilonGate(25);

	sync(rt: GlobeRuntime, frame: RenderFrame): void {
		if (!this.#gate.changed(frame.camera.altitudeM)) return;
		const { scene } = rt.viewer;
		const a = frame.atmosphere;

		scene.fog.density = a.fogDensity;
		scene.backgroundColor = new rt.Cesium.Color(a.skyTop[0], a.skyTop[1], a.skyTop[2], 1);
	}

	reset(): void {
		this.#gate.reset();
	}
}
