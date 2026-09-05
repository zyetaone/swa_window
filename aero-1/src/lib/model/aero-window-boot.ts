/**
 * Boot precedence for AeroWindow, as decisions rather than ceremony.
 *
 * The order itself is documented in the constructor and stays there — it is a
 * sequence of side effects on the model, and moving it behind a host interface
 * would relocate it without decomposing it.
 *
 * What lives here is the part that has actually gone wrong. Every boot bug in
 * this file's history was a GATE, not a step:
 *
 *   - a fresh boot orbited FlightSimEngine's class-field default (Dubai) while
 *     `location` said otherwise, showing the wrong city until the director's
 *     first hop — found in the Jul 8 visual A/B, fixed in e521696
 *   - the dev night override keyed off `Object.keys(persisted).length === 0`,
 *     but load() strips fields it refuses to restore, so a dev box that had
 *     only ever stored one of those looked like a browser that had never run
 *     the app — firing the override and forcing Real Time off for someone who
 *     did have state
 *   - `updateTimeFromSystem()` ran ungated at boot while the RECURRING sync in
 *     +page.svelte was gated on syncToRealTime, so boot clobbered timeOfDay
 *     and then froze — killing both the dev deep-night default and any
 *     persisted syncToRealTime:false kiosk's show-opening time
 *
 * None of those throw. They present as "the wall is showing the wrong thing",
 * which is the most expensive kind of bug on an unattended fleet. Expressing
 * them as a pure function makes each gate assertable in isolation instead of
 * requiring a constructed model plus a mocked localStorage.
 */

export interface BootInputs {
	/** import.meta.env.DEV at the call site — never true on a Pi. */
	isDev: boolean;
	/** False during SSR; several boot steps are browser-only. */
	hasWindow: boolean;
	/**
	 * Whether the browser has REAL persisted state — from hasPersistedState(),
	 * not from inspecting the loaded blob. load() strips fields it refuses to
	 * restore (location/weather/syncToRealTime), so the blob can be empty for
	 * a browser that has plenty stored.
	 */
	hasPersisted: boolean;
	/** The model's syncToRealTime AFTER persisted state has been applied. */
	syncToRealTime: boolean;
}

export interface BootDecision {
	/**
	 * Force deep night (22:00) with Real Time off, so the night-light pipeline
	 * is visible by default while iterating in `bun run dev`.
	 */
	applyDevNightOverride: boolean;
	/** Pull wall-clock time into timeOfDay during boot. */
	syncTimeFromSystem: boolean;
}

/** Deep-night hour used by the dev override. */
export const DEV_NIGHT_HOUR = 22;

/**
 * Resolve the boot gates.
 *
 * The dev override is evaluated FIRST and, when it fires, suppresses the
 * wall-clock sync: the two are contradictory by construction — one pins 22:00,
 * the other overwrites it with the actual hour — and letting both run is
 * precisely the bug where the deep-night default silently stopped working.
 */
export function decideBoot(inputs: BootInputs): BootDecision {
	const applyDevNightOverride = inputs.hasWindow && inputs.isDev && !inputs.hasPersisted;
	return {
		applyDevNightOverride,
		// Gated on syncToRealTime to match the recurring sync in +page.svelte,
		// and on the override so it cannot immediately undo it.
		syncTimeFromSystem: inputs.hasWindow && inputs.syncToRealTime && !applyDevNightOverride,
	};
}
