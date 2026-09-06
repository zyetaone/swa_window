/**
 * reload-budget — cap how often the watchdog may reload itself.
 *
 * The stall watchdog in `Display.svelte` reloads the page when the render loop
 * stops. That is the right move for a TRANSIENT fault: a lost WebGL context, a
 * wedged tile fetch, a driver hiccup. It is the wrong move for a PERMANENT one,
 * and the two are indistinguishable at the moment of detection.
 *
 * Without a cap the permanent case is a strobe. A Pi whose GPU cannot
 * initialise at all reaches BOOT_SEC with no first frame, waits out RELOAD_SEC,
 * reloads, and arrives back at exactly the same state — so the wall flashes
 * white every sixty seconds, all night, and keeps doing it until someone drives
 * to the site. A frozen window is at least a photograph of an aeroplane window;
 * a strobing one is visibly broken in a way that reads as a hardware failure.
 *
 * v1 already learned this. `aero-1/src/lib/world/lifecycle-liveness.ts` caps
 * self-healing reloads at three per hour and hands the rest to the nightly
 * reboot, with a comment noting that every reload path must share one budget —
 * "checking without consuming would let a persistent fault reload-loop
 * forever". The rewrite carried the watchdog across and left the cap behind.
 *
 * `sessionStorage`, not `localStorage`: the budget must survive a reload (which
 * sessionStorage does) and must NOT survive a deliberate restart of the kiosk
 * (which localStorage would). A field tech power-cycling a Pi should get a
 * clean three attempts, not a budget spent by yesterday's fault.
 */

const KEY = 'aero.reload.log';
const WINDOW_MS = 3_600_000;
export const MAX_RELOADS_PER_HOUR = 3;

/**
 * Storage is optional, and its absence must not disable the watchdog.
 *
 * Chromium in `--incognito` — which is what `aero-kiosk.service` runs — still
 * provides sessionStorage, but a quota error or a hardened profile can make it
 * throw. If the budget cannot be read the honest fallback is to ALLOW the
 * reload: an uncapped recovery is bad, and no recovery at all is worse.
 */
function readLog(now: number): number[] {
	try {
		const raw = sessionStorage.getItem(KEY);
		const arr: unknown = raw ? JSON.parse(raw) : [];
		if (!Array.isArray(arr)) return [];
		return arr.filter((t): t is number => typeof t === 'number' && now - t < WINDOW_MS);
	} catch {
		return [];
	}
}

/** How many reloads remain in this hour. Exported for the diagnostics readout. */
export function reloadsRemaining(now: number = Date.now()): number {
	return Math.max(0, MAX_RELOADS_PER_HOUR - readLog(now).length);
}

/**
 * Check AND consume one reload, atomically.
 *
 * One function rather than a separate `available()` and `record()` on purpose:
 * v1's comment is explicit that a caller which checks without consuming
 * reload-loops forever, and two functions is an invitation to do exactly that.
 */
export function tryConsumeReloadBudget(now: number = Date.now()): boolean {
	const log = readLog(now);
	if (log.length >= MAX_RELOADS_PER_HOUR) return false;
	try {
		sessionStorage.setItem(KEY, JSON.stringify([...log, now]));
	} catch {
		/* Unwritable storage cannot track the cap; still allow the reload. */
	}
	return true;
}
