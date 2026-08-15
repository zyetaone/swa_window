/**
 * Kiosk thermal load-shed — poll loopback thermal state and reduce GPU work
 * when the Pi is throttling or hot.
 *
 * Policy SSOT: `$lib/fleet/throttle` (same thresholds as health-check).
 * Actions are LOCAL only (applyConfigPatch, no fleet broadcast intent) so one
 * warm edge pane does not force the corridor to performance mode.
 *
 * Shed (not restore): we only force `qualityMode=performance` and
 * `useThreeOverlay=false`. Clearing heat does NOT auto-restore ultra —
 * operators raise quality from admin after the wall cools. That avoids a
 * shed/restore oscillation when the room is marginal.
 */
import type { AeroWindow } from '$lib/model/aero-window.svelte';
import type { ThermalStateFile } from '$lib/fleet/throttle';

/** How often the kiosk re-reads /api/internal/thermal. */
export const THERMAL_POLL_MS = 30_000;

/**
 * Start polling. Returns a stop function for onDestroy.
 * No-ops cleanly when the endpoint is 204 (dev laptop / no health-check).
 */
export function startThermalGuard(model: AeroWindow): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setInterval> | null = null;

	const tick = async () => {
		if (stopped) return;
		try {
			const res = await fetch('/api/internal/thermal', { cache: 'no-store' });
			if (res.status === 204 || !res.ok) return;
			const state = (await res.json()) as ThermalStateFile;
			if (state.action !== 'shed') return;

			// Already as lean as we force — skip CRDT noise.
			const q = model.config.world.qualityMode;
			const three = model.config.world.useThreeOverlay;
			if (q === 'performance' && three === false) return;

			model.applyConfigPatch('world.qualityMode', 'performance');
			model.applyConfigPatch('world.useThreeOverlay', false);
			model.telemetry.recordEvent('info', {
				event: 'thermal_shed',
				tempC: state.tempC,
				throttledRaw: state.throttledRaw,
				livePressure: state.flags?.livePressure ?? false,
			});
		} catch {
			/* best-effort — never break the kiosk for a thermal poll miss */
		}
	};

	void tick();
	timer = setInterval(() => { void tick(); }, THERMAL_POLL_MS);

	return () => {
		stopped = true;
		if (timer) clearInterval(timer);
		timer = null;
	};
}
