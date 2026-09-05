/**
 * wall-clock — ONE ticking clock for the whole app.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Three places grew their own copy: BlindInfoCard (30 s interval + a `_tick`
 * counter read inside a `$derived` to force invalidation), the admin dashboard
 * (1 s interval storing a whole `Date` in `$state`), and now the cabin clock.
 * Each ran its own timer, so a kiosk showing both the blind card and the clock
 * ticked twice on independent schedules and could display 10:59 next to 11:00
 * for up to 30 s.
 *
 * ─── WHY IT IS A MODULE, NOT A COMPONENT ────────────────────────────────────
 * Svelte 5 runes work at module scope in a `.svelte.ts` file, so a single
 * `$state` here is shared by every consumer without prop-drilling or context.
 * The interval is REFERENCE-COUNTED: it starts when the first consumer
 * subscribes and stops when the last unmounts, so a kiosk with the clock hidden
 * pays nothing. That matters on a Pi 5 where the render budget is already tight.
 *
 * Consumers use `$derived` to format, so formatting cost is paid once per tick
 * per format, not once per frame.
 */

/** Ticks once per second while anything is subscribed. */
let now = $state(Date.now());

let timer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;

/**
 * Subscribe to the shared clock for the lifetime of a component.
 *
 * Call inside `$effect`; the returned teardown stops the shared interval when
 * the last consumer goes away:
 *
 *     $effect(() => subscribeWallClock());
 */
export function subscribeWallClock(): () => void {
	subscribers++;
	if (timer === null) {
		now = Date.now();          // don't show a stale value for up to a second
		timer = setInterval(() => { now = Date.now(); }, 1000);
	}
	// Each teardown releases its OWN subscription exactly once. Without this
	// latch a double-call (Svelte can re-run a cleanup during HMR, and callers
	// legitimately hold the handle) decrements twice for one subscribe, driving
	// the count negative — after which `subscribers <= 0` is true while a real
	// consumer is still mounted, so the next unsubscribe stops a clock that is
	// still on screen. Caught by test, not by inspection.
	let released = false;
	return () => {
		if (released) return;
		released = true;
		subscribers--;
		if (subscribers <= 0 && timer !== null) {
			clearInterval(timer);
			timer = null;
			subscribers = 0;
		}
	};
}

/** Current epoch ms. Reactive — read it inside `$derived`. */
export function wallClockNow(): number {
	return now;
}

/** Test/introspection hook: is the shared interval currently running? */
export function wallClockIsRunning(): boolean {
	return timer !== null;
}

/** Test hook: how many consumers hold the clock open. */
export function wallClockSubscriberCount(): number {
	return subscribers;
}

/**
 * `HH:MM` in the viewer's locale, 24-hour.
 *
 * 24-hour deliberately: this is cabin/airport furniture, and a departure board
 * never shows AM/PM. Seconds are a separate opt-in because a seconds display
 * forces a repaint every second on a panel that is otherwise near-static.
 */
export function formatClock(epochMs: number, withSeconds = false): string {
	const d = new Date(epochMs);
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	if (!withSeconds) return `${hh}:${mm}`;
	return `${hh}:${mm}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Long-form date line, e.g. "Mon 4 Aug". */
export function formatClockDate(epochMs: number): string {
	return new Date(epochMs).toLocaleDateString([], {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
	});
}
