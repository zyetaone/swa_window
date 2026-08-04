/**
 * use-double-tap — a double-tap / double-click gesture that coexists with the
 * blind's drag handling.
 *
 * ─── WHY NOT JUST `ondblclick` ──────────────────────────────────────────────
 * Two reasons the native event is not enough here:
 *
 *  1. TOUCH. On the kiosk (and any tablet) a fast double-tap does not reliably
 *     produce `dblclick`; browsers synthesise it inconsistently and often add a
 *     ~300 ms delay. Tracking `pointerup` pairs ourselves is immediate and
 *     behaves the same for mouse, pen and finger.
 *  2. THE BLIND. `Blind.svelte` puts a full-window `.blind-grab` overlay with
 *     `pointer-events: auto` above the scene to catch drag-to-close, so a
 *     listener further down never sees the tap. This attaches wherever the
 *     caller needs (including that overlay) and deliberately does NOT call
 *     `preventDefault`/`stopPropagation`, so the drag still works — a tap that
 *     turns out to be the start of a drag simply never completes the pair.
 *
 * A tap only counts toward a pair if the pointer barely moved between down and
 * up (MOVE_TOLERANCE_PX), which is what separates "tapped twice" from "started
 * dragging the blind twice".
 */

/** Max ms between the two taps. 400 is comfortable without firing on slow, deliberate double-clicks of two separate things. */
const GAP_MS = 400;

/** Max px the pointer may travel within one tap before it counts as a drag, not a tap. */
const MOVE_TOLERANCE_PX = 12;

/** Max px between the two taps' positions — two taps in different places are two taps, not a double-tap. */
const SPREAD_TOLERANCE_PX = 48;

export interface DoubleTapOptions {
	/** Fired when a genuine double-tap completes. */
	onDoubleTap: () => void;
}

/**
 * Svelte action. Usage:
 *
 *     <div use:doubleTap={{ onDoubleTap: () => (visible = !visible) }}></div>
 */
export function doubleTap(node: HTMLElement, options: DoubleTapOptions) {
	let opts = options;

	let downX = 0;
	let downY = 0;
	let moved = false;

	let lastTapAt = 0;
	let lastTapX = 0;
	let lastTapY = 0;

	const onPointerDown = (e: PointerEvent) => {
		downX = e.clientX;
		downY = e.clientY;
		moved = false;
	};

	const onPointerMove = (e: PointerEvent) => {
		if (moved) return;
		if (Math.hypot(e.clientX - downX, e.clientY - downY) > MOVE_TOLERANCE_PX) moved = true;
	};

	const onPointerUp = (e: PointerEvent) => {
		// A drag (the blind gesture) is not a tap.
		if (moved) { lastTapAt = 0; return; }

		const now = performance.now();
		const withinTime = now - lastTapAt <= GAP_MS;
		const withinSpace =
			Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) <= SPREAD_TOLERANCE_PX;

		if (lastTapAt !== 0 && withinTime && withinSpace) {
			lastTapAt = 0;               // consume the pair; a third tap starts fresh
			opts.onDoubleTap();
			return;
		}

		lastTapAt = now;
		lastTapX = e.clientX;
		lastTapY = e.clientY;
	};

	// `pointercancel` (scroll takeover, palm rejection) must clear the pending
	// tap, or a stale first-tap can pair with an unrelated later one.
	const onPointerCancel = () => { lastTapAt = 0; moved = false; };

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerup', onPointerUp);
	node.addEventListener('pointercancel', onPointerCancel);

	return {
		update(next: DoubleTapOptions) { opts = next; },
		destroy() {
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerup', onPointerUp);
			node.removeEventListener('pointercancel', onPointerCancel);
		},
	};
}

/** Exported for tests — the tuning that defines "a double tap". */
export const DOUBLE_TAP_TUNING = {
	GAP_MS,
	MOVE_TOLERANCE_PX,
	SPREAD_TOLERANCE_PX,
} as const;
