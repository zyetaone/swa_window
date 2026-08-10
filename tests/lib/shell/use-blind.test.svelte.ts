/**
 * useBlind pointercancel — the mid-drag abort path.
 *
 * A pointercancel (touch takeover, palm rejection) used to leave the blind
 * stuck: isDragging stayed true forever, dragY froze mid-travel, the $effect
 * that resyncs dragY from config stayed blocked, and a pending long-press
 * pressTimer kept running. The cancel handler must reset drag state, clear
 * timers, and snap back — WITHOUT committing a new blind state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { useBlind } from '$lib/shell/window/use-blind.svelte';

const OPEN_Y = -105;
const CLOSED_Y = 0;

function harness({ blindOpen = false } = {}) {
	const shell = $state({ blindOpen, touchEnabled: true });
	const model = {
		config: { shell },
		applyConfigPatch: vi.fn((path: string, value: unknown) => {
			if (path === 'shell.blindOpen') shell.blindOpen = value as boolean;
			return true;
		}),
		flight: { isTransitioning: false },
		pickNextLocation: () => 'next',
		flyTo: vi.fn(),
	};

	let blind!: ReturnType<typeof useBlind>;
	const stop = $effect.root(() => {
		blind = useBlind(model);
	});
	flushSync();

	// 400px clip so pointer px → drag % is exact (happy-dom offsetHeight is 0).
	const clip = document.createElement('div');
	Object.defineProperty(clip, 'offsetHeight', { value: 400, configurable: true });
	blind.attach(clip);

	const pointer = (x: number, y: number) =>
		({
			clientX: x,
			clientY: y,
			pointerId: 1,
			currentTarget: { setPointerCapture: vi.fn() },
		}) as unknown as PointerEvent;

	return {
		blind,
		shell,
		model,
		pointer,
		stop,
		/** Drag from open partway down (dy px) without releasing. */
		dragFromOpen(dy: number) {
			blind.onPointerDown(pointer(100, 100));
			blind.onPointerMove(pointer(100, 100 + dy));
		},
	};
}

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('useBlind pointercancel', () => {
	it('mid-drag cancel snaps dragY back to the config position', () => {
		const h = harness({ blindOpen: true });
		h.dragFromOpen(80); // 20% of travel
		expect(h.blind.dragY).not.toBe(OPEN_Y);
		expect(h.blind.transition).toBe('none'); // live drag: no CSS transition

		h.blind.onPointerCancel();
		flushSync();

		expect(h.blind.dragY).toBe(OPEN_Y);
		expect(h.blind.transition).toContain('transform'); // snap-back is animated
		h.stop();
	});

	it('cancel does NOT commit, even past the snap threshold (pointerup would)', () => {
		const h = harness({ blindOpen: true });
		h.dragFromOpen(160); // 40% > 30% snap threshold
		h.blind.onPointerCancel();
		flushSync();
		expect(h.model.applyConfigPatch).not.toHaveBeenCalled();
		expect(h.blind.dragY).toBe(OPEN_Y);

		// Contrast: the same drag ending in pointerup commits the close.
		h.dragFromOpen(160);
		h.blind.onPointerUp();
		expect(h.model.applyConfigPatch).toHaveBeenCalledWith('shell.blindOpen', false);
		h.stop();
	});

	it('cancel clears a pending long-press timer', () => {
		vi.useFakeTimers();
		const h = harness();
		h.blind.onPointerDown(h.pointer(100, 100));
		h.blind.onPointerCancel();
		vi.advanceTimersByTime(1000); // well past the 400ms threshold
		expect(h.blind.accelerated).toBe(false);
		expect(h.blind.speedMultiplier).toBe(1);
		h.stop();
	});

	it('cancel after long-press fired resets acceleration immediately', () => {
		vi.useFakeTimers();
		const h = harness();
		h.blind.onPointerDown(h.pointer(100, 100));
		vi.advanceTimersByTime(500); // long-press fires
		expect(h.blind.accelerated).toBe(true);
		expect(h.blind.speedMultiplier).toBe(3);

		h.blind.onPointerCancel();
		expect(h.blind.accelerated).toBe(false);
		expect(h.blind.speedMultiplier).toBe(1);
		h.stop();
	});

	it('cancel unblocks the dragY resync from config', () => {
		const h = harness(); // closed
		h.blind.onPointerDown(h.pointer(100, 100));
		h.blind.onPointerMove(h.pointer(100, 60)); // drag UP 40px → mid-travel
		expect(h.blind.dragY).toBe(-10);

		// External config change mid-drag: resync is blocked while dragging.
		h.shell.blindOpen = true;
		flushSync();
		expect(h.blind.dragY).toBe(-10);

		// After cancel the resync re-arms and dragY follows config.
		h.blind.onPointerCancel();
		flushSync();
		expect(h.blind.dragY).toBe(OPEN_Y);
		h.stop();
	});

	it('cancel with no active drag is a no-op', () => {
		const h = harness();
		expect(() => h.blind.onPointerCancel()).not.toThrow();
		flushSync();
		expect(h.blind.dragY).toBe(CLOSED_Y);
		h.stop();
	});
});
