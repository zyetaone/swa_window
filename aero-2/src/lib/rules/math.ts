/**
 * Small shared arithmetic. Lives in rules/ because only rules/ uses it —
 * a lib-wide `utils` bucket is where unrelated things go to hide.
 */

export function normalizeHeading(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

/** True when `target` has drifted far enough from `held` to retile or swap. */
export function exceedsDeadband(held: number | null, target: number, threshold: number): boolean {
	return held === null || Math.abs(target - held) >= threshold;
}
