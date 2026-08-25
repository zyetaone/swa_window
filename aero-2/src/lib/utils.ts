export function normalizeHeading(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

/**
 * True when `target` has drifted far enough from `held` to be worth acting on.
 *
 * Both callers guard a change that is expensive AND visible: retiling the globe
 * and swapping an imagery provider. Undamped, either would fire repeatedly while
 * its input hovers near a boundary — and on three panes it would fire on
 * different frames, which reads as a torn wall rather than a slow one.
 *
 * A null `held` means nothing has been applied yet, so the first value always
 * commits.
 */
export function exceedsDeadband(held: number | null, target: number, threshold: number): boolean {
	return held === null || Math.abs(target - held) >= threshold;
}
