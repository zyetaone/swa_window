/**
 * evalWhen — pure function that translates a declarative WhenPredicate into
 * a boolean by reading reactive fields from the WindowModel. Used by the
 * bundle loader to produce an Effect.when closure.
 *
 * Contract: no field = no constraint. AND across fields, OR within a field.
 */

import type { WindowModel } from '$lib/model/state.svelte';
import type { WhenPredicate } from './types';

/** Returns true when every specified constraint is satisfied by model's current state. */
export function evalWhen(pred: WhenPredicate | undefined, model: WindowModel): boolean {
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
