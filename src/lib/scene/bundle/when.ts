/**
 * evalWhen — pure function that translates a declarative WhenPredicate into
 * a boolean by reading reactive fields from the AeroWindow. Used by the
 * bundle loader to produce an Effect.when closure.
 *
 * Contract: no field = no constraint. AND across fields, OR within a field.
 */

import type { AeroWindow } from '$lib/model/aero-window.svelte';
import type { WhenPredicate } from './types';

/** Returns true when every specified constraint is satisfied by model's current state. */
export function evalWhen(pred: WhenPredicate | undefined, model: AeroWindow): boolean {
	if (!pred) return true;

	if (pred.location && !pred.location.includes(model.location)) return false;

	if (pred.nightFactor) {
		const nf = model.nightFactor;
		if (pred.nightFactor.min !== undefined && nf < pred.nightFactor.min) return false;
		if (pred.nightFactor.max !== undefined && nf > pred.nightFactor.max) return false;
	}

	if (pred.skyState && !pred.skyState.includes(model.skyState)) return false;

	if (pred.weather && !pred.weather.includes(model.weather)) return false;

	return true;
}
