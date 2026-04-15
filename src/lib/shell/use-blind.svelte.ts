/**
 * useBlind — composable for the airplane window blind drag/snap controller.
 *
 * Encapsulates all blind state, derived values, and pointer/keyboard handlers.
 * Window.svelte binds `blind.clipEl` and wires the returned handlers directly.
 */

import { clamp } from '$lib/utils';

/** Narrow interface — only what the blind needs from WindowModel. */
export interface BlindControl {
	blindOpen: boolean;
	flight: { isTransitioning: boolean };
}

const SNAP_THRESHOLD = 0.3;
const OPEN_Y = -105;
const CLOSED_Y = 0;

export function useBlind(model: BlindControl) {
	let clipEl: HTMLDivElement | undefined = $state();
	let isDragging = $state(false);
	let hasAnimated = $state(false);
	let dragY = $state(model.blindOpen ? OPEN_Y : CLOSED_Y);

	let containerHeight = 0;
	let dragStartY = 0;
	let dragStartPointerY = 0;

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
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		const deltaPct = ((e.clientY - dragStartPointerY) / containerHeight) * 100;
		dragY = clamp(dragStartY + deltaPct, OPEN_Y, CLOSED_Y);
	}

	function onPointerUp() {
		if (!isDragging) return;
		isDragging = false;
		const travelRatio = Math.abs(dragY - dragStartY) / Math.abs(OPEN_Y);
		if (travelRatio > SNAP_THRESHOLD) {
			model.blindOpen = dragY < dragStartY;
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
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onKeyDown,
	};
}
