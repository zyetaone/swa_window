/**
 * Liveness watchdog — closes the "frozen-but-alive at 3am" gap.
 *
 * systemd restarts a DEAD process; the game-loop watchdog reloads on
 * THROWN-exception loops. Neither notices the three real kiosk killers:
 * WebGL context loss (GL calls become silent no-ops), a silent render
 * stall (fps→0, no exception), or a wedged boot. This module is the third
 * leg: a 30s interval that checks registered GL canvases + the measured
 * fps, and performs a BOUNDED page reload when the display is provably
 * dead. The audience sees the boot splash/blind on reload, never an error
 * (council: never break the fiction).
 *
 * Bounded: max 3 watchdog reloads per rolling hour (sessionStorage — the
 * nightly 04:00 reboot clears it via fresh browser session). A hard fault
 * (e.g. GPU driver truly gone) stops reloading and leaves recovery to the
 * nightly reboot rather than strobing the display.
 *
 * Framework-free (no runes) so it can be unit-tested and reused by any
 * route. Wire-up lives in Pane.svelte ($effect start/stop) and the canvas
 * owners call registerCanvas().
 */

export interface LivenessOptions {
	/** Called to read the current measured fps (0 = stalled). */
	getFps: () => number;
	/** Telemetry sink — receives ('error', payload) style events. */
	recordEvent: (kind: 'error' | 'info', payload: unknown) => void;
	/** Check interval, ms. Default 30s. */
	intervalMs?: number;
	/** Consecutive dead checks required before reload. Default 2 (≥60s dead). */
	deadChecksBeforeReload?: number;
	/** Injected for tests. Defaults to window.location.reload. */
	reload?: () => void;
}

const RELOAD_LOG_KEY = 'aero-liveness-reloads';
const MAX_RELOADS_PER_HOUR = 3;

/** True when the watchdog is still allowed to reload (under the hourly cap). */
export function reloadBudgetAvailable(now: number = Date.now()): boolean {
	return readReloadLog(now).length < MAX_RELOADS_PER_HOUR;
}

/**
 * Atomically check AND consume one reload from the hourly budget. Every
 * self-healing reload in the app (watchdog, Cesium init auto-retry) must go
 * through this — checking without consuming would let a persistent fault
 * reload-loop forever.
 */
export function tryConsumeReloadBudget(now: number = Date.now()): boolean {
	if (!reloadBudgetAvailable(now)) return false;
	recordReload(now);
	return true;
}

function readReloadLog(now: number): number[] {
	try {
		const raw = sessionStorage.getItem(RELOAD_LOG_KEY);
		const arr: unknown = raw ? JSON.parse(raw) : [];
		if (!Array.isArray(arr)) return [];
		return arr.filter((t): t is number => typeof t === 'number' && now - t < 3_600_000);
	} catch {
		return [];
	}
}

function recordReload(now: number): void {
	try {
		sessionStorage.setItem(RELOAD_LOG_KEY, JSON.stringify([...readReloadLog(now), now]));
	} catch {
		/* sessionStorage unavailable — cap can't be tracked; still reload */
	}
}

// Registered GL canvases (Cesium + Three overlay register on mount).
const canvases = new Set<HTMLCanvasElement>();

/** Canvas owners register here; returns an unregister function. */
export function registerLivenessCanvas(canvas: HTMLCanvasElement): () => void {
	canvases.add(canvas);
	return () => canvases.delete(canvas);
}

/** Minimal telemetry surface needed to report a context loss. */
interface LossReporter {
	recordEvent(kind: 'error', detail: Record<string, unknown>): void;
}

/**
 * Register a GL canvas with the watchdog AND log its context-loss events, as
 * one operation with one teardown.
 *
 * Both renderers need exactly this pair: a canvas that dies (GPU/driver reset
 * overnight on a Pi) makes every subsequent GL call a silent no-op — nothing
 * throws, so only the watchdog's `isContextLost()` poll notices, and the
 * listener supplies the precise timestamp. Registering without listening loses
 * the timestamp; listening without registering loses the recovery.
 *
 * They were previously wired by hand in `CesiumViewer.svelte` and
 * `ThreeOverlay.svelte`, and had already drifted: only the Three copy released
 * a prior registration before taking a new one, so a re-created Cesium viewer
 * could orphan the old canvas in the watchdog set and keep polling a dead
 * context forever. This version always releases first.
 */
export function attachCanvasLiveness(
	canvas: HTMLCanvasElement,
	where: string,
	telemetry: LossReporter,
	previous?: (() => void) | null,
): () => void {
	previous?.();
	const unregister = registerLivenessCanvas(canvas);
	const onLost = (e: Event) => {
		e.preventDefault(); // signal intent to restore
		telemetry.recordEvent('error', { where, event: 'webglcontextlost' });
	};
	canvas.addEventListener('webglcontextlost', onLost);
	return () => {
		canvas.removeEventListener('webglcontextlost', onLost);
		unregister();
	};
}

function anyContextLost(): boolean {
	for (const canvas of canvases) {
		// Either context kind; getContext returns the EXISTING context.
		const gl =
			(canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
			(canvas.getContext('webgl') as WebGLRenderingContext | null);
		if (gl?.isContextLost()) return true;
	}
	return false;
}

/**
 * Start the watchdog. Returns a stop function.
 * Reload fires only after `deadChecksBeforeReload` CONSECUTIVE dead checks
 * (default 2 → at least a full minute of confirmed death), and only within
 * the hourly reload budget.
 */
export function startLivenessWatchdog(opts: LivenessOptions): () => void {
	const intervalMs = opts.intervalMs ?? 30_000;
	const deadThreshold = opts.deadChecksBeforeReload ?? 2;
	const reload = opts.reload ?? (() => window.location.reload());
	let consecutiveDead = 0;

	const id = setInterval(() => {
		// Hidden tab: RAF legitimately pauses (fps 0) — not death.
		if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
			consecutiveDead = 0;
			return;
		}
		const contextLost = anyContextLost();
		const fpsStalled = opts.getFps() <= 0;
		if (!contextLost && !fpsStalled) {
			consecutiveDead = 0;
			return;
		}
		consecutiveDead++;
		opts.recordEvent('error', {
			where: 'liveness',
			contextLost,
			fpsStalled,
			consecutiveDead,
		});
		if (consecutiveDead < deadThreshold) return;

		if (!tryConsumeReloadBudget()) {
			// Budget exhausted — a hard fault. Leave it to the nightly reboot
			// instead of strobing the display with reload loops.
			opts.recordEvent('error', { where: 'liveness', reloadBudgetExhausted: true });
			consecutiveDead = 0;
			return;
		}
		reload();
	}, intervalMs);

	return () => clearInterval(id);
}
