/**
 * doubleTap — the gesture that toggles the cabin clock.
 *
 * The case that actually matters: Blind.svelte lays a full-window `.blind-grab`
 * overlay over the scene to catch drag-to-close, so this gesture has to live
 * alongside a drag handler on the same element. A tap that turns into a drag
 * must NOT count, or pulling the blind twice would flash the clock on and off.
 */
import { describe, it, expect, vi } from 'vitest';
import { doubleTap, DOUBLE_TAP_TUNING } from '$lib/shell/use-double-tap';

const { GAP_MS, MOVE_TOLERANCE_PX, SPREAD_TOLERANCE_PX } = DOUBLE_TAP_TUNING;

function harness() {
	const node = document.createElement('div');
	const onDoubleTap = vi.fn();
	const action = doubleTap(node, { onDoubleTap });

	const ev = (type: string, x: number, y: number) =>
		node.dispatchEvent(
			Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y }),
		);

	return {
		onDoubleTap,
		destroy: () => action.destroy?.(),
		/** A clean tap: down and up at the same point. */
		tap(x = 100, y = 100) { ev('pointerdown', x, y); ev('pointerup', x, y); },
		/** A drag: down, move beyond tolerance, up. */
		drag(x = 100, y = 100, dy = 60) {
			ev('pointerdown', x, y);
			ev('pointermove', x, y + dy);
			ev('pointerup', x, y + dy);
		},
		cancel(x = 100, y = 100) { ev('pointerdown', x, y); ev('pointercancel', x, y); },
		/** A tap with sub-tolerance jitter — what a real finger does. */
		wobbleTap(x: number, y: number, jitter: number) {
			ev('pointerdown', x, y);
			ev('pointermove', x + jitter, y);
			ev('pointerup', x + jitter, y);
		},
	};
}

describe('doubleTap', () => {
	it('fires on two quick taps in the same place', () => {
		const h = harness();
		h.tap(); h.tap();
		expect(h.onDoubleTap).toHaveBeenCalledTimes(1);
		h.destroy();
	});

	it('does NOT fire on a single tap', () => {
		const h = harness();
		h.tap();
		expect(h.onDoubleTap).not.toHaveBeenCalled();
		h.destroy();
	});

	it('does NOT fire when the taps are too far apart in time', () => {
		vi.useFakeTimers();
		const spy = vi.spyOn(performance, 'now');
		let t = 1000;
		spy.mockImplementation(() => t);

		const h = harness();
		h.tap();
		t += GAP_MS + 50;          // slower than a double-tap
		h.tap();
		expect(h.onDoubleTap).not.toHaveBeenCalled();

		h.destroy();
		spy.mockRestore();
		vi.useRealTimers();
	});

	it('does NOT fire when the taps are far apart on screen', () => {
		const h = harness();
		h.tap(100, 100);
		h.tap(100 + SPREAD_TOLERANCE_PX + 20, 100);   // two different places
		expect(h.onDoubleTap).not.toHaveBeenCalled();
		h.destroy();
	});

	// The blind-coexistence contract.
	it('does NOT fire for two blind drags', () => {
		const h = harness();
		h.drag(); h.drag();
		expect(h.onDoubleTap).not.toHaveBeenCalled();
		h.destroy();
	});

	it('does NOT pair a drag with a following tap', () => {
		const h = harness();
		h.drag();
		h.tap();
		expect(h.onDoubleTap).not.toHaveBeenCalled();
		h.destroy();
	});

	it('tolerates a tiny wobble within one tap (finger jitter)', () => {
		// A finger never lands perfectly still. Movement BELOW the tolerance
		// must still count as a tap, or the gesture fails for real humans.
		const h = harness();
		const wobble = MOVE_TOLERANCE_PX - 4;
		h.wobbleTap(100, 100, wobble);
		h.wobbleTap(100, 100, wobble);
		expect(h.onDoubleTap).toHaveBeenCalledTimes(1);
		h.destroy();
	});

	it('consumes the pair, so three taps are not two toggles', () => {
		const h = harness();
		h.tap(); h.tap(); h.tap();
		expect(h.onDoubleTap).toHaveBeenCalledTimes(1);
		h.destroy();
	});

	it('four taps toggle exactly twice', () => {
		const h = harness();
		h.tap(); h.tap(); h.tap(); h.tap();
		expect(h.onDoubleTap).toHaveBeenCalledTimes(2);
		h.destroy();
	});

	it('a pointercancel clears the pending tap', () => {
		const h = harness();
		h.tap();
		h.cancel();      // palm rejection / scroll takeover
		h.tap();
		expect(h.onDoubleTap).not.toHaveBeenCalled();
		h.destroy();
	});

	it('stops listening after destroy', () => {
		const h = harness();
		h.destroy();
		h.tap(); h.tap();
		expect(h.onDoubleTap).not.toHaveBeenCalled();
	});
});
