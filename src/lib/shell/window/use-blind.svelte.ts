/**
 * useBlind — composable for the airplane window blind drag/snap controller.
 *
 * Encapsulates all blind state, derived values, and pointer/keyboard
 * handlers. Consumer mounts the controller via `{@attach blind.attach}` on
 * the clip element (replaces the old bind:this dance) and wires the pointer
 * handlers on the draggable overlay.
 *
 * Optional long-press acceleration (SWA corridor, Day 5):
 *   Pass `{ longPress: { enabled, thresholdMs, speedMultiplier, releaseMs } }`
 *   to switch the blind into "accelerated" mode on a held press — useful on
 *   large touch panels where a tiny drag should still cover full travel. Flag
 *   stays accessible as `blind.accelerated` so the host can decorate (amber
 *   inner glow, pulsing handle, etc.). Release decelerates smoothly to 1.0
 *   over `releaseMs`.
 */

import type { Attachment } from 'svelte/attachments';
import { clamp, smoothstep } from '$lib/utils';

/** Narrow interface — only what the blind needs from AeroWindow. */
interface BlindControl {
	config: { shell: { blindOpen: boolean; touchEnabled: boolean } };
	applyConfigPatch: (path: string, value: unknown) => boolean;
	flight: { isTransitioning: boolean };
	/** Pick a next-location id based on current state. */
	pickNextLocation(): string;
	/** Trigger the flight sim to cruise to a new location. */
	flyTo(locationId: string): void;
}

interface BlindLongPressOptions {
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

interface UseBlindOptions {
	longPress?: BlindLongPressOptions;
}

const SNAP_THRESHOLD = 0.3;
const OPEN_Y = -105;
const CLOSED_Y = 0;

/**
 * Minimum gap between two blind-triggered destination changes.
 *
 * Long enough that repeated swipes can't march the display through cities;
 * short enough that someone deliberately exploring at a human pace still gets
 * a new view on their second pull.
 */
export const FLIGHT_COOLDOWN_MS = 45_000;

export function useBlind(model: BlindControl, options: UseBlindOptions = {}) {
	// Clip element is set by the `attach` attachment when the .blind-clip div
	// mounts. Plain ref (not $state) — we only read offsetHeight from it at
	// pointer-down, never reactively.
	let clipEl: HTMLDivElement | null = null;
	// Per-instance rather than module-level: the limit is about one blind on
	// one screen, and keeping it here means it cannot leak between tests.
	let lastFlightAtMs = 0;
	let isDragging = $state(false);
	let hasAnimated = $state(false);
	let dragY = $state(model.config.shell.blindOpen ? OPEN_Y : CLOSED_Y);
	let accelerated = $state(false);
	let speedMultiplier = $state(1);

	let containerHeight = 0;
	let dragStartY = 0;
	let dragStartPointerY = 0;
	let dragStartPointerX = 0;

	const attach: Attachment<HTMLDivElement> = (node) => {
		clipEl = node;
		return () => { clipEl = null; };
	};

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
			const e = smoothstep(t);
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
			dragY = model.config.shell.blindOpen ? OPEN_Y : CLOSED_Y;
		}
	});

	const transform = $derived(`translateY(${dragY.toFixed(1)}%)`);
	const transition = $derived(
		isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.22, 0.68, 0, 1.05)'
	);

	function onPointerDown(e: PointerEvent) {
		// First real interaction retires the discoverable coaching (chevrons +
		// handle breathe) for the rest of the session — set before the
		// transition gate, since even an ignored pull is still a discovery.
		hasAnimated = true;
		if (model.flight.isTransitioning) return;
		containerHeight = clipEl?.offsetHeight ?? 1;
		isDragging = true;
		dragStartY = dragY;
		dragStartPointerY = e.clientY;
		dragStartPointerX = e.clientX;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

		// Long-press acceleration is OPERATOR/DEMO behavior — gated behind
		// config.shell.touchEnabled per Q3 council. Read at pointer-down so the
		// admin toggle takes effect on the next gesture. The basic blind drag
		// itself (above) is always active regardless — it's the curtain metaphor.
		if (lpEnabled && model.config.shell.touchEnabled) {
			clearPressTimer();
			cancelRelease();
			pressTimer = setTimeout(() => {
				pressTimer = null;
				// Re-check the gate inside the callback: if touch was disabled
				// mid-press, don't accelerate.
				if (!model.config.shell.touchEnabled) return;
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

	/**
	 * Commit a new blind state. If the user just CLOSED the blind (from open),
	 * that's the canonical "fly somewhere new" gesture — fire it here so the
	 * blind-pull becomes a scene-change trigger. Mid-cruise pulls are ignored
	 * (isTransitioning gate) to avoid re-firing during cruise_departure.
	 *
	 * The blind itself ALWAYS responds — only the destination change is rate
	 * limited. The gesture staying responsive is what keeps it feeling like a
	 * physical blind; it is the world-change behind it that must not be
	 * spammable. Without the cooldown, the isTransitioning gate only covered
	 * the ~2 s cruise, so anyone could hop the display between cities as fast
	 * as they could swipe — which reads as a glitchy toy rather than calm
	 * ambient furniture, and undoes the whole premise on repeat exposure.
	 */
	function commitBlind(nextOpen: boolean): void {
		const wasOpen = model.config.shell.blindOpen;
		model.applyConfigPatch('shell.blindOpen', nextOpen);
		if (!wasOpen || nextOpen || model.flight.isTransitioning) return;
		const now = Date.now();
		if (now - lastFlightAtMs < FLIGHT_COOLDOWN_MS) return;
		lastFlightAtMs = now;
		model.flyTo(model.pickNextLocation());
	}

	function onPointerUp() {
		if (!isDragging) return;
		isDragging = false;
		const travelRatio = Math.abs(dragY - dragStartY) / Math.abs(OPEN_Y);
		if (travelRatio > SNAP_THRESHOLD) {
			commitBlind(dragY < dragStartY);
		}
		if (lpEnabled) {
			clearPressTimer();
			if (accelerated) {
				accelerated = false;
				decelerateTo(1);
			}
		}
	}

	/**
	 * `pointercancel` (touch takeover, palm rejection) aborts the gesture
	 * WITHOUT committing — the same treatment use-double-tap gives its pending
	 * tap. Clearing isDragging re-arms the resync $effect above, which snaps
	 * dragY back to the config-driven position with the CSS transition.
	 */
	function onPointerCancel() {
		if (!isDragging) return;
		isDragging = false;
		if (lpEnabled) {
			clearPressTimer();
			cancelRelease();
			if (accelerated) {
				accelerated = false;
				speedMultiplier = 1;
			}
		}
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') commitBlind(!model.config.shell.blindOpen);
	}

	return {
		attach,
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
		onPointerCancel,
		onKeyDown,
	};
}
