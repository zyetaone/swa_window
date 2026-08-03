/**
 * transitionDelayMs — bounds a peer-supplied wall-clock instant into a sane
 * setTimeout delay.
 *
 * The 3-Pi panorama synchronises scene changes by having the leader broadcast
 * an absolute `transitionAtMs` that every follower schedules against. That
 * makes each follower's timer depend on ANOTHER device's clock, and a Pi with
 * a dead RTC boots into a wildly wrong time until NTP catches up.
 *
 * The dangerous case is not "slightly off" — it is a delay above 2^31-1 ms,
 * which overflows setTimeout's 32-bit field and fires the callback IMMEDIATELY.
 * That desynchronises the panorama at the exact moment the schedule exists to
 * hold it together.
 */
import { describe, it, expect } from 'vitest';
import {
	transitionDelayMs,
	TRANSITION_DELAY_MS,
	MAX_TRANSITION_LEAD_MS,
} from '$lib/fleet/protocol';

const NOW = 1_800_000_000_000;

describe('transitionDelayMs', () => {
	it('passes through the normal leader lead time unchanged', () => {
		expect(transitionDelayMs(NOW + TRANSITION_DELAY_MS, NOW)).toBe(TRANSITION_DELAY_MS);
	});

	it('collapses past instants to fire immediately', () => {
		expect(transitionDelayMs(NOW - 1, NOW)).toBe(0);
		expect(transitionDelayMs(NOW - 60_000, NOW)).toBe(0);
		expect(transitionDelayMs(NOW, NOW)).toBe(0);
	});

	it('caps a far-future instant instead of overflowing setTimeout', () => {
		// 2^31 ms ≈ 24.8 days. Unclamped, setTimeout treats this as 1 and fires
		// at once — the failure this function exists to prevent.
		const overflowing = NOW + 2 ** 31 + 1000;
		const delay = transitionDelayMs(overflowing, NOW);
		expect(delay).toBe(MAX_TRANSITION_LEAD_MS);
		expect(delay).toBeLessThan(2 ** 31 - 1);
	});

	it('caps ordinary clock skew (an hour, a day) to the lead bound', () => {
		expect(transitionDelayMs(NOW + 3_600_000, NOW)).toBe(MAX_TRANSITION_LEAD_MS);
		expect(transitionDelayMs(NOW + 86_400_000, NOW)).toBe(MAX_TRANSITION_LEAD_MS);
	});

	it('never returns a negative or non-finite delay', () => {
		for (const at of [NaN, Infinity, -Infinity, NOW - 1e15, NOW + 1e15]) {
			const d = transitionDelayMs(at, NOW);
			expect(Number.isFinite(d)).toBe(true);
			expect(d).toBeGreaterThanOrEqual(0);
			expect(d).toBeLessThanOrEqual(MAX_TRANSITION_LEAD_MS);
		}
	});

	it('leaves headroom above the leader lead time for real NTP drift', () => {
		// A follower a few seconds behind must still schedule, not clamp to 0.
		expect(MAX_TRANSITION_LEAD_MS).toBeGreaterThan(TRANSITION_DELAY_MS * 4);
		expect(transitionDelayMs(NOW + TRANSITION_DELAY_MS + 5_000, NOW))
			.toBe(TRANSITION_DELAY_MS + 5_000);
	});
});
