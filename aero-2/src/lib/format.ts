/**
 * Display formatting for the handful of quantities more than one surface shows.
 *
 * These existed as private copies in Hud.svelte and Settings.svelte, and the
 * copies already DISAGREED: Settings rounded the minutes while the Hud floored
 * them, so one `timeOfDay` could read 17:41 in the drawer and 17:40 on the
 * ribbon at the same instant. Two clocks on one pane showing different minutes
 * is precisely the class of "which one is broken?" that a passenger notices
 * and an operator cannot explain.
 *
 * Flooring is the correct convention — a clock shows 17:40 until 17:41 IS
 * true, it does not round 17:40:31 up — so the Hud's version won.
 */

/** Fractional hours -> "HH:MM", flooring. 17.6934 -> "17:41". */
export function formatClock(hours: number): string {
	if (!Number.isFinite(hours)) return '--:--';
	const totalMinutes = Math.floor(hours * 60);
	const h = Math.floor(totalMinutes / 60) % 24;
	const m = totalMinutes % 60;
	return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** UTC offset in hours -> "UTC+5:30" / "UTC-6". Fractional zones are real. */
export function formatUtcOffset(offset: number): string {
	const sign = offset >= 0 ? '+' : '-';
	const abs = Math.abs(offset);
	const h = Math.floor(abs);
	const m = Math.round((abs - h) * 60);
	return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${m.toString().padStart(2, '0')}`;
}
