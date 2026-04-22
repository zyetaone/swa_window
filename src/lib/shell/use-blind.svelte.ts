/**
 * useBlind — composable for the airplane window blind drag/snap controller.
 *
 * Encapsulates all blind state, derived values, and pointer/keyboard handlers.
 * Window.svelte binds `blind.clipEl` and wires the returned handlers directly.
 *
 * Optional long-press acceleration (SWA corridor, Day 5):
 *   Pass `{ longPress: { enabled, thresholdMs, speedMultiplier, releaseMs } }`
 *   to switch the blind into "accelerated" mode on a held press — useful on
 *   large touch panels where a tiny drag should still cover full travel. Flag
 *   stays accessible as `blind.accelerated` so the host can decorate (amber
 *   inner glow, pulsing handle, etc.). Release decelerates smoothly to 1.0
 *   over `releaseMs`.
 */

import { clamp } from '$lib/utils';

/** Narrow interface — only what the blind needs from WindowModel. */
export interface BlindControl {
	blindOpen: boolean;
	flight: { isTransitioning: boolean };
}

export interface BlindLongPressOptions {
	enabled?: boolean;
	/** Hold duration (ms) before long-press fires. Default 400. */
	thresholdMs?: number;
	/** Speed multiplier while accelerated. Default 3.0. */
	speedMultiplier?: number;
	/** Max horizontal pointer movement during press before it's treated as a
	 *  drag gesture (cancels long-press). Default 8 CSS px. */
	maxHorizontalPx?: number;
	/** Decel time back to 1.0 on release. Default 300 ms. */
	releaseMs?: number;
}

export interface UseBlindOptions {
	longPress?: BlindLongPressOptions;
}

const SNAP_THRESHOLD = 0.3;
const OPEN_Y = -105;
const CLOSED_Y = 0;

export function useBlind(model: BlindControl, options: UseBlindOptions = {}) {
	let clipEl: HTMLDivElement | undefined = $state();
	let isDragging = $state(false);
	let hasAnimated = $state(false);
	let dragY = $state(model.blindOpen ? OPEN_Y : CLOSED_Y);
	let accelerated = $state(false);
	let speedMultiplier = $state(1);

	let containerHeight = 0;
	let dragStartY = 0;
	let dragStartPointerY = 0;
	let dragStartPointerX = 0;

	// Long-press machinery.
	const lp = options.longPress ?? {};
	const lpEnabled = lp.enabled !== false; // default on when options.longPress passed
	const lpThreshold = lp.thresholdMs ?? 400;
	const lpSpeed = lp.speedMultiplier ?? 3.0;
	const lpMaxHorizontal = lp.maxHorizontalPx ?? 8;
	const lpRelease = lp.releaseMs ?? 300;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let releaseRaf: number | null = null;

	function cancelRelease() {
		if (releaseRaf !== null) {
			cancelAnimationFrame(releaseRaf);
			releaseRaf = null;
		}
	}

	function decelerateTo(target: number) {
		cancelRelease();
		const from = speedMultiplier;
		const t0 = performance.now();
		const step = (now: number) => {
			const t = clamp((now - t0) / lpRelease, 0, 1);
			// ease-out smoothstep
			const e = t * t * (3 - 2 * t);
			speedMultiplier = from + (target - from) * e;
			if (t < 1) releaseRaf = requestAnimationFrame(step);
			else {
				releaseRaf = null;
				speedMultiplier = target;
			}
		};
		releaseRaf = requestAnimationFrame(step);
	}

	function clearPressTimer() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	}

	// Keep dragY in sync with external model changes when not dragging.
	$effect(() => {
		if (!isDragging) {
			dragY = model.blindOpen ? OPEN_Y : CLOSED_Y;
		}
	});

	const transform = $derived(`translateY(${dragY.toFixed(1)}%)`);
	const transition = $derived(
		isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.22, 0.68, 0, 1.05)'
	);

	function onPointerDown(e: PointerEvent) {
		if (model.flight.isTransitioning) return;
		containerHeight = clipEl?.offsetHeight ?? 1;
		isDragging = true;
		dragStartY = dragY;
		dragStartPointerY = e.clientY;
		dragStartPointerX = e.clientX;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

		if (lpEnabled) {
			clearPressTimer();
			cancelRelease();
			pressTimer = setTimeout(() => {
				pressTimer = null;
				accelerated = true;
				speedMultiplier = lpSpeed;
			}, lpThreshold);
		}
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		// If the user drags horizontally past the threshold, treat as a pan
		// gesture and cancel the pending long-press.
		if (lpEnabled && pressTimer !== null) {
			const dx = Math.abs(e.clientX - dragStartPointerX);
			if (dx > lpMaxHorizontal) clearPressTimer();
		}
		const deltaPct = ((e.clientY - dragStartPointerY) / containerHeight) * 100 * speedMultiplier;
		dragY = clamp(dragStartY + deltaPct, OPEN_Y, CLOSED_Y);
	}

	function onPointerUp() {
		if (!isDragging) return;
		isDragging = false;
		const travelRatio = Math.abs(dragY - dragStartY) / Math.abs(OPEN_Y);
		if (travelRatio > SNAP_THRESHOLD) {
			model.blindOpen = dragY < dragStartY;
		}
		if (lpEnabled) {
			clearPressTimer();
			if (accelerated) {
				accelerated = false;
				decelerateTo(1);
			}
		}
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') model.blindOpen = !model.blindOpen;
	}

	return {
		get clipEl() { return clipEl; },
		set clipEl(v: HTMLDivElement | undefined) { clipEl = v; },
		get transform() { return transform; },
		get transition() { return transition; },
		get hasAnimated() { return hasAnimated; },
		set hasAnimated(v: boolean) { hasAnimated = v; },
		get dragY() { return dragY; },
		get accelerated() { return accelerated; },
		get speedMultiplier() { return speedMultiplier; },
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onKeyDown,
	};
}
