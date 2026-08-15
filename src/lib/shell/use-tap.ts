/**
 * use-tap — a single-tap / click gesture that coexists with the blind's
 * drag handling. Toggles the cabin clock.
 *
 * ─── WHY NOT JUST `onclick` ───────────────────────────────────────────────
 *  1. THE BLIND. `Blind.svelte` puts a full-window `.blind-grab` overlay with
 *     `pointer-events: auto` above the scene to catch drag-to-close. A tap
 *     that turns out to be the start of a drag must NOT count, or pulling the
 *     blind would flash the clock — so a tap only fires when the pointer
 *     barely moved between down and up (MOVE_TOLERANCE_PX). This action
 *     deliberately does NOT call `preventDefault`/`stopPropagation`, so the
 *     drag still works.
 *  2. TOUCH. Pointer events behave identically for mouse, pen and finger;
 *     no 300 ms click-delay heuristics to fight.
 *
 * History: this was a DOUBLE-tap gesture (use-double-tap.ts). Single-tap
 * replaced it — the clock is furniture an office passer-by should reach in
 * one touch, and the drag guard already keeps the blind gesture from
 * false-firing.
 */

/** Max px the pointer may travel within one tap before it counts as a drag, not a tap. */
const MOVE_TOLERANCE_PX = 12;

/**
 * Max hold time for a tap. Longer holds belong to other gestures — the
 * blind's long-press acceleration arms at ~400 ms (use-blind.svelte.ts), and
 * releasing a held blind without dragging must not flash the clock as an
 * unexplained side effect.
 */
const MAX_PRESS_MS = 500;

export interface TapOptions {
	/** Fired when a genuine tap completes (down+up, pointer barely moved). */
	onTap: () => void;
}

/**
 * Svelte action. Usage:
 *
 *     <div use:tap={{ onTap: () => (visible = !visible) }}></div>
 */
export function tap(node: HTMLElement, options: TapOptions) {
	let opts = options;

	let downX = 0;
	let downY = 0;
	let downAt = 0;
	let down = false;
	let moved = false;

	const onPointerDown = (e: PointerEvent) => {
		// Only the primary pointer's main button starts a tap. A second finger
		// mid-press must not move the tap origin out from under the first
		// finger, and right-click is not a tap. (=== false / > 0 so synthetic
		// test events without these fields still count.)
		if (e.isPrimary === false || (e.button ?? 0) > 0) return;
		downX = e.clientX;
		downY = e.clientY;
		downAt = e.timeStamp;
		down = true;
		moved = false;
	};

	const onPointerMove = (e: PointerEvent) => {
		if (!down || moved) return;
		if (Math.hypot(e.clientX - downX, e.clientY - downY) > MOVE_TOLERANCE_PX) moved = true;
	};

	const onPointerUp = (e: PointerEvent) => {
		// Only a press that STARTED here counts — a drag that began outside
		// the container and happens to release over it is not a tap. Neither
		// is a long hold (that's the blind's gesture).
		if (down && !moved && e.timeStamp - downAt <= MAX_PRESS_MS) opts.onTap();
		down = false;
	};

	// `pointercancel` (scroll takeover, palm rejection) must not fire a tap.
	const onPointerCancel = () => { down = false; moved = false; };

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerup', onPointerUp);
	node.addEventListener('pointercancel', onPointerCancel);

	return {
		update(next: TapOptions) { opts = next; },
		destroy() {
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerup', onPointerUp);
			node.removeEventListener('pointercancel', onPointerCancel);
		},
	};
}

/** Exported for tests — the tuning that defines "a tap". */
export const TAP_TUNING = {
	MOVE_TOLERANCE_PX,
	MAX_PRESS_MS,
} as const;
