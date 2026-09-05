/**
 * Raspberry Pi thermal / power throttle flags.
 *
 * `vcgencmd get_throttled` returns a bitfield (hex). Bits 0–3 are live;
 * bits 16–19 are sticky "has occurred since boot". See Raspberry Pi firmware
 * docs. Pure parse helpers — health-check.sh encodes the same bits in the
 * heartbeat payload; this module is the SSOT for decoding + load-shed policy
 * so admin UI and tests don't re-inline magic numbers.
 *
 * Lives under `fleet/` (not `server/`) so the kiosk thermal-guard can import
 * types without pulling a server-only path into the client graph.
 */

/** Live under-voltage (bit 0). */
export const THROTTLE_BIT_UNDER_VOLTAGE = 1 << 0;
/** Live arm frequency capped (bit 1). */
export const THROTTLE_BIT_FREQ_CAPPED = 1 << 1;
/** Live soft/hard throttle (bit 2). */
export const THROTTLE_BIT_THROTTLED = 1 << 2;
/** Live soft temperature limit (bit 3). */
export const THROTTLE_BIT_SOFT_TEMP = 1 << 3;

/** Sticky: under-voltage has occurred since boot (bit 16). */
export const THROTTLE_BIT_UNDER_VOLTAGE_OCCURRED = 1 << 16;
/** Sticky: freq cap has occurred (bit 17). */
export const THROTTLE_BIT_FREQ_CAPPED_OCCURRED = 1 << 17;
/** Sticky: throttle has occurred (bit 18). */
export const THROTTLE_BIT_THROTTLED_OCCURRED = 1 << 18;
/** Sticky: soft temp limit has occurred (bit 19). */
export const THROTTLE_BIT_SOFT_TEMP_OCCURRED = 1 << 19;

export interface ThrottleFlags {
	/** Raw bitfield (0 if unknown / non-Pi). */
	raw: number;
	underVoltage: boolean;
	freqCapped: boolean;
	/** Currently throttled (firmware reducing clocks for heat/power). */
	throttled: boolean;
	softTempLimit: boolean;
	/** Sticky since boot — useful for "did we throttle overnight?" */
	underVoltageOccurred: boolean;
	freqCappedOccurred: boolean;
	throttledOccurred: boolean;
	softTempLimitOccurred: boolean;
	/** Any live pressure bit set. */
	livePressure: boolean;
}

/** Parse hex string or number from vcgencmd / health-check. */
export function parseThrottledRaw(input: unknown): number {
	if (typeof input === 'number' && Number.isFinite(input) && input >= 0) {
		return Math.floor(input) >>> 0;
	}
	if (typeof input === 'string') {
		const s = input.trim().toLowerCase().replace(/^throttled=/, '');
		const n = s.startsWith('0x') ? Number.parseInt(s, 16) : Number.parseInt(s, 10);
		if (Number.isFinite(n) && n >= 0) return n >>> 0;
	}
	return 0;
}

export function decodeThrottleFlags(raw: number): ThrottleFlags {
	const r = raw >>> 0;
	const underVoltage = (r & THROTTLE_BIT_UNDER_VOLTAGE) !== 0;
	const freqCapped = (r & THROTTLE_BIT_FREQ_CAPPED) !== 0;
	const throttled = (r & THROTTLE_BIT_THROTTLED) !== 0;
	const softTempLimit = (r & THROTTLE_BIT_SOFT_TEMP) !== 0;
	return {
		raw: r,
		underVoltage,
		freqCapped,
		throttled,
		softTempLimit,
		underVoltageOccurred: (r & THROTTLE_BIT_UNDER_VOLTAGE_OCCURRED) !== 0,
		freqCappedOccurred: (r & THROTTLE_BIT_FREQ_CAPPED_OCCURRED) !== 0,
		throttledOccurred: (r & THROTTLE_BIT_THROTTLED_OCCURRED) !== 0,
		softTempLimitOccurred: (r & THROTTLE_BIT_SOFT_TEMP_OCCURRED) !== 0,
		livePressure: underVoltage || freqCapped || throttled || softTempLimit,
	};
}

/**
 * Load-shed thresholds (°C). Hysteresis: shed at/above SHED, clear only at/below
 * CLEAR — avoids flapping the quality mode at the boundary.
 *
 * Pi 5 firmware typically starts soft limiting ~80–85 °C; we shed a few
 * degrees earlier so Cesium work drops before clocks collapse.
 */
export const THERMAL_SHED_TEMP_C = 78;
export const THERMAL_CLEAR_TEMP_C = 70;

export type ThermalAction = 'ok' | 'shed';

/**
 * Decide whether the kiosk should shed GPU load (quality performance +
 * Three overlay off). Pure policy: health-check and the kiosk guard share it.
 */
export function thermalAction(
	tempC: number,
	flags: Pick<ThrottleFlags, 'livePressure'>,
	prev: ThermalAction = 'ok',
): ThermalAction {
	const temp = Number.isFinite(tempC) ? tempC : 0;
	if (flags.livePressure || temp >= THERMAL_SHED_TEMP_C) return 'shed';
	if (prev === 'shed' && temp > THERMAL_CLEAR_TEMP_C) return 'shed';
	return 'ok';
}

/** Wire shape written by health-check and read by GET /api/internal/thermal. */
export interface ThermalStateFile {
	tempC: number;
	throttledRaw: number;
	action: ThermalAction;
	/** Unix ms when health-check last wrote. */
	updatedAtMs: number;
	flags: ThrottleFlags;
}
