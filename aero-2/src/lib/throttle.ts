/**
 * Raspberry Pi thermal / power throttle policy.
 *
 * `vcgencmd get_throttled` returns a hex bitfield. health-check.sh encodes the
 * same bits into `/run/aero/thermal.json`, so this module is the one place that
 * decodes them and the one place that decides what to do about it — the server
 * route and (later) the display's own guard share it rather than re-inlining
 * magic numbers.
 *
 * Lives at `lib/` root, not `lib/server/`: it is pure, and the display will
 * import it. `server/` imports nothing from a feature slice, and a feature
 * slice must not import `server/`.
 *
 * Only the four LIVE bits are decoded. v1 also decoded four sticky
 * "has occurred since boot" bits (16-19) that nothing ever read. The raw field
 * is carried through unchanged, so decoding them later is a four-line addition
 * against data already on the wire.
 */

const BIT_UNDER_VOLTAGE = 1 << 0;
const BIT_FREQ_CAPPED = 1 << 1;
const BIT_THROTTLED = 1 << 2;
const BIT_SOFT_TEMP = 1 << 3;

export interface ThrottleFlags {
	/** Raw bitfield, 0 when unknown or off-Pi. */
	raw: number;
	underVoltage: boolean;
	freqCapped: boolean;
	/** Firmware is reducing clocks right now, for heat or for power. */
	throttled: boolean;
	softTempLimit: boolean;
	/** Any live pressure bit set. */
	livePressure: boolean;
}

/** Accepts the hex string vcgencmd prints, the `throttled=0x0` form, or a number. */
export function parseThrottledRaw(input: unknown): number {
	if (typeof input === 'number' && Number.isFinite(input) && input >= 0) {
		return Math.floor(input) >>> 0;
	}
	if (typeof input === 'string') {
		const s = input
			.trim()
			.toLowerCase()
			.replace(/^throttled=/, '');
		const n = s.startsWith('0x') ? Number.parseInt(s, 16) : Number.parseInt(s, 10);
		if (Number.isFinite(n) && n >= 0) return n >>> 0;
	}
	return 0;
}

export function decodeThrottleFlags(raw: number): ThrottleFlags {
	const r = raw >>> 0;
	const underVoltage = (r & BIT_UNDER_VOLTAGE) !== 0;
	const freqCapped = (r & BIT_FREQ_CAPPED) !== 0;
	const throttled = (r & BIT_THROTTLED) !== 0;
	const softTempLimit = (r & BIT_SOFT_TEMP) !== 0;
	return {
		raw: r,
		underVoltage,
		freqCapped,
		throttled,
		softTempLimit,
		livePressure: underVoltage || freqCapped || throttled || softTempLimit
	};
}

/**
 * Shed at or above SHED, clear only at or below CLEAR. The gap is hysteresis:
 * a single threshold makes the quality mode flap every few seconds at the
 * boundary, which is more visible on the wall than the heat ever was.
 *
 * Pi 5 firmware starts soft-limiting around 80-85 °C. Shedding a few degrees
 * early means the renderer drops work before the clocks collapse under it.
 */
export const THERMAL_SHED_TEMP_C = 78;
export const THERMAL_CLEAR_TEMP_C = 70;

export type ThermalAction = 'ok' | 'shed';

/** Pure policy. `prev` is what keeps the hysteresis band from being one-way. */
export function thermalAction(
	tempC: number,
	flags: Pick<ThrottleFlags, 'livePressure'>,
	prev: ThermalAction = 'ok'
): ThermalAction {
	const temp = Number.isFinite(tempC) ? tempC : 0;
	if (flags.livePressure || temp >= THERMAL_SHED_TEMP_C) return 'shed';
	if (prev === 'shed' && temp > THERMAL_CLEAR_TEMP_C) return 'shed';
	return 'ok';
}

/** The shape health-check.sh writes and GET /api/internal/thermal returns. */
export interface ThermalState {
	tempC: number;
	throttledRaw: number;
	action: ThermalAction;
	/** Unix ms of health-check's last write. */
	updatedAtMs: number;
	flags: ThrottleFlags;
}
