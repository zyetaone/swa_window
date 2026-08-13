/**
 * Global RAF loop -- single animation frame source.
 * Subscriber pattern: components register callbacks, loop auto-starts/stops.
 * Includes visibility check (saves CPU when tab hidden) and per-subscriber
 * error tracking with emergency reload after 10 consecutive failures.
 * The reload goes through the shared hourly reload budget
 * (lifecycle-liveness); once exhausted the failing subscriber is
 * unsubscribed instead of reload-looping the kiosk forever. rafId is
 * cleared BEFORE the reload attempt so that if the reload is blocked or
 * no-ops (e.g. a beforeunload handler), the loop is left stopped-but-
 * restartable via subscribe() → start(), not permanently dead.
 */

import { STORAGE_KEY } from '$lib/model/persistence';
import { tryConsumeReloadBudget } from '$lib/world/lifecycle-liveness';

type Callback = (dt: number) => void;

const subscribers = new Set<Callback>();
const errorCounts = new WeakMap<Callback, number>();
let rafId: number | null = null;
let lastTime = 0;

function loop(now: number): void {
	// Skip when tab is hidden (saves CPU on Pi kiosk)
	if (document.visibilityState === 'hidden') {
		rafId = requestAnimationFrame(loop);
		lastTime = now; // prevent dt spike on resume
		return;
	}

	const dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;

	for (const fn of subscribers) {
		try {
			fn(dt);
			if (errorCounts.get(fn)) errorCounts.set(fn, 0);
		} catch {
			const count = (errorCounts.get(fn) ?? 0) + 1;
			errorCounts.set(fn, count);
			if (count >= 10) {
				try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
				if (tryConsumeReloadBudget()) {
					// Clear rafId BEFORE reload: the current frame already fired,
					// and if the reload is blocked or no-ops we return without
					// scheduling the next frame — leaving rafId non-null would
					// brick the loop (start() early-returns on rafId !== null).
					rafId = null;
					window.location.reload();
					return;
				}
				// Budget exhausted — a permanently-throwing subscriber must not
				// strobe the kiosk with reload loops. Drop it and carry on.
				console.warn('[game-loop] reload budget exhausted; unsubscribing failing callback');
				subscribers.delete(fn);
				errorCounts.delete(fn);
			}
		}
	}

	rafId = requestAnimationFrame(loop);
}

function start(): void {
	if (rafId !== null) return;
	lastTime = performance.now();
	rafId = requestAnimationFrame(loop);
}

function stop(): void {
	if (rafId !== null) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}
}

/** Subscribe a callback to the RAF loop. Returns an unsubscribe function. */
export function subscribe(fn: Callback): () => void {
	subscribers.add(fn);
	errorCounts.set(fn, 0);
	// Unconditional start(), not `size === 1`: start() guards on rafId
	// internally, and after a blocked/no-op reload the loop is dead with
	// rafId null while subscribers remain — a size-gated start would never
	// fire for them (size never returns to 1), leaving the kiosk frameless.
	start();

	return () => {
		subscribers.delete(fn);
		errorCounts.delete(fn); // prevent stale entries from lingering
		if (subscribers.size === 0) stop();
	};
}
