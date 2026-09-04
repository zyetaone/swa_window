/**
 * Polling this device's own thermal state.
 *
 * Same shape as `wall-poll`, and deliberately NOT the same channel: the wall is
 * one shared state pushed to every pane, and this is strictly local. A hot edge
 * pane must shed its own work without dimming the other two, so this never
 * leaves the device — `/api/internal/thermal` is loopback-only for exactly that
 * reason.
 *
 * WHY THIS EXISTS: the endpoint, the bitfield decoder, the hysteresis policy
 * and the health-check writer were all built and tested, and nothing under
 * `display/` ever called any of it. The route's own docstring asserted "the
 * display polls this and sheds its own GPU work" as a statement of fact. It did
 * not — this is the missing consumer.
 *
 * That is the same shape as `data/roads/` (packaged, served, drawn by nothing):
 * every part works, so nothing can go red, and the Pi throttles in silence
 * while the display keeps asking for the frames that are cooking it.
 */

import { thermalAction, type ThermalAction, type ThermalState } from '#lib/throttle.js';

/**
 * 15 s. `health-check.sh` writes every 60 s, so polling faster than that only
 * re-reads the same file — but a quarter of the write period bounds how long
 * the display keeps burning GPU after the firmware has already started
 * clamping clocks.
 */
export const THERMAL_POLL_MS = 15_000;

export interface ThermalPoller {
	/** One round trip. Exposed so a test can drive it without a timer. */
	poll(): Promise<void>;
	stop(): void;
}

export interface ThermalSink {
	/** Called only when the action CHANGES, so a caller cannot thrash on it. */
	setAction(action: ThermalAction): void;
	readonly action: ThermalAction;
}

/**
 * Poll `/api/internal/thermal` and report the shed decision.
 *
 * Every failure mode resolves to 'ok' rather than to 'shed', and that is a
 * deliberate asymmetry: a device with no thermal reporting is the NORMAL case
 * off-Pi (dev machines, the smoke run, any install without health-check), and
 * degrading the visuals everywhere because a file is absent would be a far
 * bigger regression than running hot on the one device that is genuinely
 * throttling. `state: null` means "nothing is reporting", not "all is well" —
 * the endpoint is careful to distinguish those, and so is this.
 */
export function createThermalPoller(
	sink: ThermalSink,
	fetchFn: typeof fetch = fetch,
	origin = ''
): ThermalPoller {
	let stopped = false;

	const poll = async () => {
		if (stopped) return;
		try {
			const res = await fetchFn(`${origin}/api/internal/thermal`, {
				headers: { accept: 'application/json' }
			});
			if (!res.ok) return;
			const body = (await res.json()) as { state: ThermalState | null };
			if (!body || typeof body !== 'object' || !body.state) return;

			const { tempC, flags } = body.state;
			// Recomputed here rather than trusting the server's `action`, because
			// the hysteresis band needs THIS pane's previous decision — the server
			// has no memory of what this display is currently doing.
			const next = thermalAction(tempC, flags ?? { livePressure: false }, sink.action);
			if (next !== sink.action) sink.setAction(next);
		} catch {
			/* Offline, 403 off-loopback, or malformed: stay as we are. */
		}
	};

	const timer = setInterval(poll, THERMAL_POLL_MS);
	void poll();

	return {
		poll,
		stop() {
			stopped = true;
			clearInterval(timer);
		}
	};
}
