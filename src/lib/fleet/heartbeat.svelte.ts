/**
 * Fleet heartbeat — in-memory ring buffer for per-device metrics.
 *
 * Each Pi POSTs to /api/fleet/heartbeat every 60s (via deploy/pi/health-check.sh).
 * The admin server stores the last ~8 hours of samples per device (500 entries
 * × 60s = 30000s ≈ 8.3h). The /admin/fleet/health page reads this and renders
 * a live tile per device with the most recent metrics + a sparkline.
 *
 * Contract — heartbeat POST body (matches deploy/pi/health-check.sh):
 *   {
 *     deviceId:    string    // hostname
 *     role:        string    // 'solo' | 'left' | 'center' | 'right'
 *     groupId:     string
 *     fps:         number    // avg FPS as reported by local /api/fleet?health
 *     temp:        number    // CPU °C
 *     uptime:      number    // seconds since boot
 *     crashCount:  number    // aero-kiosk.service NRestarts
 *   }
 *
 * This is a pure state module — no DOM, no fetch. It's imported by the
 * +server.ts route, not by a component. The `.svelte.ts` suffix is kept
 * for consistency with other fleet modules that use $state (this one uses
 * plain module-level Map/Array for server-side hot-reload friendliness).
 */

export interface HeartbeatSample {
	/** Wall-clock ms when the admin received the sample. */
	receivedAt: number;
	deviceId: string;
	role: string;
	groupId: string;
	fps: number;
	temp: number;
	uptime: number;
	crashCount: number;
}

/** How many samples we keep per device. 500 × 60s ≈ 8.3h. */
export const MAX_SAMPLES_PER_DEVICE = 500;

/**
 * Per-device ring buffer. Oldest samples drop off once we hit
 * MAX_SAMPLES_PER_DEVICE. We use a plain array rather than a circular
 * buffer because 500 elements is tiny and the dashboard wants
 * chronological order anyway.
 */
const samples = new Map<string, HeartbeatSample[]>();

/**
 * Record an incoming heartbeat.
 *
 * Rejects (returns false) if the payload is malformed — we never trust
 * Pi-supplied data blindly since this endpoint is network-facing inside
 * the corridor LAN. Valid samples are appended and the oldest one is
 * evicted if we're at the cap.
 */
export function recordHeartbeat(input: unknown): HeartbeatSample | null {
	if (!input || typeof input !== 'object') return null;
	const o = input as Record<string, unknown>;

	const deviceId = typeof o.deviceId === 'string' ? o.deviceId : null;
	if (!deviceId || deviceId.length === 0 || deviceId.length > 128) return null;

	// Numeric fields — default to 0 on missing/bad input so a partially-failed
	// health-check still gets recorded (better: "device is up but reporting 0"
	// than "no signal at all").
	const numeric = (key: string): number => {
		const v = o[key];
		return typeof v === 'number' && Number.isFinite(v) ? v : 0;
	};

	const sample: HeartbeatSample = {
		receivedAt: Date.now(),
		deviceId,
		role: typeof o.role === 'string' ? o.role : 'solo',
		groupId: typeof o.groupId === 'string' ? o.groupId : 'default',
		fps: numeric('fps'),
		temp: numeric('temp'),
		uptime: numeric('uptime'),
		crashCount: numeric('crashCount'),
	};

	const buf = samples.get(deviceId) ?? [];
	buf.push(sample);
	// Drop oldest when at cap. slice() is O(n) but 500 is tiny so this is fine.
	if (buf.length > MAX_SAMPLES_PER_DEVICE) {
		buf.splice(0, buf.length - MAX_SAMPLES_PER_DEVICE);
	}
	samples.set(deviceId, buf);
	return sample;
}

/**
 * Get the most recent sample for a device, or null if none recorded yet.
 * Used by the /admin/fleet/health tile display.
 */
export function latestSample(deviceId: string): HeartbeatSample | null {
	const buf = samples.get(deviceId);
	if (!buf || buf.length === 0) return null;
	return buf[buf.length - 1];
}

/**
 * Get the full sample history for a device. Returned array is a copy so
 * callers can sort / filter without mutating the ring buffer.
 */
export function historyForDevice(deviceId: string): HeartbeatSample[] {
	const buf = samples.get(deviceId);
	return buf ? buf.slice() : [];
}

/**
 * Snapshot of the latest heartbeat from every device we've ever heard from.
 * Used by the dashboard to render one tile per device.
 */
export function latestAll(): HeartbeatSample[] {
	const out: HeartbeatSample[] = [];
	for (const buf of samples.values()) {
		if (buf.length > 0) out.push(buf[buf.length - 1]);
	}
	return out;
}

/**
 * Is the device considered online? We say yes if we've seen a heartbeat in
 * the last 3 intervals (= 3 × 60s = 3 min). Any longer and the Pi is
 * probably crashed or offline.
 */
const ONLINE_THRESHOLD_MS = 3 * 60_000;

export function isOnline(sample: HeartbeatSample, now: number = Date.now()): boolean {
	return now - sample.receivedAt < ONLINE_THRESHOLD_MS;
}

/**
 * Compute basic rollups across the whole fleet — the dashboard header uses
 * these. Online count, average FPS across online devices, hottest CPU, etc.
 */
export interface FleetSummary {
	total: number;
	online: number;
	offline: number;
	avgFps: number;
	maxTempC: number;
	totalCrashes: number;
}

export function summarize(now: number = Date.now()): FleetSummary {
	const all = latestAll();
	const online = all.filter((s) => isOnline(s, now));
	const offline = all.length - online.length;
	const avgFps =
		online.length > 0 ? online.reduce((sum, s) => sum + s.fps, 0) / online.length : 0;
	const maxTempC = online.reduce((max, s) => Math.max(max, s.temp), 0);
	const totalCrashes = all.reduce((sum, s) => sum + s.crashCount, 0);
	return {
		total: all.length,
		online: online.length,
		offline,
		avgFps: Math.round(avgFps * 10) / 10,
		maxTempC,
		totalCrashes,
	};
}

// ─── Test hooks ─────────────────────────────────────────────────────────────

export function _resetForTests(): void {
	samples.clear();
}
