/**
 * tap — the single-tap gesture that toggles the cabin clock.
 *
 * The case that actually matters: Blind.svelte lays a full-window `.blind-grab`
 * overlay over the scene to catch drag-to-close, so this gesture has to live
 * alongside a drag handler on the same element. A tap that turns into a drag
 * must NOT count, or pulling the blind would flash the clock.
 */
import { describe, it, expect, vi } from 'vitest';
import { tap, TAP_TUNING } from '$lib/shell/use-tap';

const { MOVE_TOLERANCE_PX } = TAP_TUNING;

function harness() {
	const node = document.createElement('div');
	const onTap = vi.fn();
	const action = tap(node, { onTap });

	const ev = (type: string, x: number, y: number) =>
		node.dispatchEvent(
			Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y }),
		);

	return {
		onTap,
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

describe('tap', () => {
	it('fires on a single tap', () => {
		const h = harness();
		h.tap();
		expect(h.onTap).toHaveBeenCalledTimes(1);
		h.destroy();
	});

	it('fires once per tap — two taps fire twice', () => {
		const h = harness();
		h.tap(); h.tap();
		expect(h.onTap).toHaveBeenCalledTimes(2);
		h.destroy();
	});

	// The blind-coexistence contract.
	it('does NOT fire for a blind drag', () => {
		const h = harness();
		h.drag();
		expect(h.onTap).not.toHaveBeenCalled();
		h.destroy();
	});

	it('does NOT fire on the pointerup that ends a drag', () => {
		const h = harness();
		h.drag();
		h.tap();       // a genuine tap AFTER the drag still counts
		expect(h.onTap).toHaveBeenCalledTimes(1);
		h.destroy();
	});

	it('tolerates a tiny wobble within one tap (finger jitter)', () => {
		// A finger never lands perfectly still. Movement BELOW the tolerance
		// must still count as a tap, or the gesture fails for real humans.
		const h = harness();
		h.wobbleTap(100, 100, MOVE_TOLERANCE_PX - 4);
		expect(h.onTap).toHaveBeenCalledTimes(1);
		h.destroy();
	});

	it('a pointercancel does not fire a tap', () => {
		const h = harness();
		h.cancel();    // palm rejection / scroll takeover mid-press
		expect(h.onTap).not.toHaveBeenCalled();
		h.destroy();
	});

	it('stops listening after destroy', () => {
		const h = harness();
		h.destroy();
		h.tap();
		expect(h.onTap).not.toHaveBeenCalled();
	});
});
