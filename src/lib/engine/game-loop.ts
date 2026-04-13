/**
 * Global RAF loop -- single animation frame source.
 * Subscriber pattern: components register callbacks, loop auto-starts/stops.
 * Includes visibility check (saves CPU when tab hidden) and per-subscriber
 * error tracking with emergency reload after 10 consecutive failures.
 */

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
			errorCounts.set(fn, 0);
		} catch {
			const count = (errorCounts.get(fn) ?? 0) + 1;
			errorCounts.set(fn, count);
			if (count >= 10) {
				try { localStorage.removeItem('aero-window-v2'); } catch { /* noop */ }
				window.location.reload();
				return;
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
	if (subscribers.size === 1) start();

	return () => {
		subscribers.delete(fn);
		if (subscribers.size === 0) stop();
	};
}
