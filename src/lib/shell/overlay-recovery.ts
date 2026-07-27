/**
 * Overlay recovery — auto-disable the Three overlay on underpowered hardware.
 *
 * The liveness watchdog only catches fps == 0 (stall/death). A Pi 5 that can
 * handle Cesium at ~8 fps but drops to ~3 fps with the Three overlay is never
 * "dead" — just silently degraded. This module detects sustained low fps and
 * disables the overlay (persisting the decision across reboots so a fleet-
 * deployed Pi doesn't re-engage every boot cycle).
 *
 * Framework-free — no runes, testable. Wire-up in Pane.svelte.
 */

/** Three consecutive 30s checks below this fps threshold triggers disable. */
const FPS_MIN_THRESHOLD = 5;
const CHECK_INTERVAL_MS = 30_000;
const CONSECUTIVE_CHECKS = 3;

const OVERLAY_DISABLED_KEY = 'aero-overlay-disabled';

/** Check whether the overlay was previously disabled due to low performance. */
export function isOverlayPersistentlyDisabled(): boolean {
	try {
		return sessionStorage.getItem(OVERLAY_DISABLED_KEY) === '1';
	} catch {
		return false;
	}
}

/** Persist the disabled state so it survives reboot. */
function persistDisabled(): void {
	try {
		sessionStorage.setItem(OVERLAY_DISABLED_KEY, '1');
	} catch {
		/* sessionStorage unavailable — still disable in-memory */
	}
}

/** Clear the persistent disable (user re-enabled via SidePanel). */
export function clearOverlayDisabled(): void {
	try {
		sessionStorage.removeItem(OVERLAY_DISABLED_KEY);
	} catch {
		/* noop */
	}
}

export interface OverlayRecoveryOptions {
	/** Called to read the current measured fps. */
	getFps: () => number;
	/** Called to disable the overlay (applyConfigPatch + persist). */
	disableOverlay: () => void;
	/** Check interval, ms. Default 30s. */
	intervalMs?: number;
	/** FPS threshold to consider "too slow". Default 5. */
	fpsMinThreshold?: number;
	/** Consecutive slow checks required. Default 3 (≥90s sustained low fps). */
	slowChecksRequired?: number;
}

/**
 * Start the overlay recovery monitor. Returns a stop function.
 *
 * Design: separate from the liveness watchdog — the watchdog handles "dead"
 * (fps=0) and this handles "alive but too slow." Both run from Pane.svelte
 * $effects and use the same measuredFps source. They don't interact.
 */
export function startOverlayRecovery(opts: OverlayRecoveryOptions): () => void {
	const intervalMs = opts.intervalMs ?? CHECK_INTERVAL_MS;
	const threshold = opts.fpsMinThreshold ?? FPS_MIN_THRESHOLD;
	const required = opts.slowChecksRequired ?? CONSECUTIVE_CHECKS;
	let consecutiveSlow = 0;

	const id = setInterval(() => {
		if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
			consecutiveSlow = 0;
			return;
		}
		const fps = opts.getFps();
		if (fps <= 0) {
			// Dead — let the liveness watchdog handle this. Don't decrement the
			// slow counter (a dead GPU isn't "slow", it's dead).
			return;
		}
		if (fps >= threshold) {
			consecutiveSlow = 0;
			return;
		}
		consecutiveSlow++;
		if (consecutiveSlow >= required) {
			persistDisabled();
			opts.disableOverlay();
		}
	}, intervalMs);

	return () => clearInterval(id);
}
