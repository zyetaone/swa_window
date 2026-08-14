/**
 * Fleet type surface — types shared by device browser (SSE client) and
 * admin browser (REST client). Post-WS cleanup: the v1/v2 wire-message
 * unions, hub ServerMessage discriminants, and isV2() guard are gone —
 * there's no wire format to negotiate anymore. REST endpoints speak plain
 * JSON shapes that live next to their handlers in routes/api/*.
 *
 * What stays:
 *   FleetClientModel — narrow interface the device's SSE client needs
 *                      from AeroWindow.
 *   DisplayConfig    — flat admin-pushable override DTO (legacy v1).
 *   DeviceInfo       — admin-side row shape for the device table.
 */

import type { LocationId, WeatherType, DisplayMode, QualityMode, VantageBeat } from '$lib/types';
import type { Telemetry } from '$lib/model/telemetry.svelte';
import type { ConfigPatchOpts } from '$lib/model/config-tree.svelte';

export interface FleetClientModel {
	measuredFps: number;
	displayMode: DisplayMode;
	location: LocationId;
	weather: WeatherType;
	qualityMode: QualityMode;
	syncToRealTime: boolean;
	/** Navigate to a location, optionally setting weather. */
	applyScene(location: LocationId, weather?: WeatherType): void;
	/** Schedule a night-city flyover beat locked to a shared transitionAtMs.
	 *  Optional so test stubs and older models stay valid; the client feature-tests. */
	scheduleFlyover?(beat: VantageBeat, transitionAtMs: number): void;
	setDisplayMode(
		mode: DisplayMode,
		payload?: string,
		opts?: { decidedAtMs?: number; force?: boolean },
	): boolean | void;
	setQualityMode(mode: QualityMode): void;
	setAltitude(alt: number): void;
	setTime(t: number): void;
	setFlightSpeed(n: number): void;
	/**
	 * Path-targeted patch — applied through RootConfig.applyConfigPatch.
	 * Returns true if the path was recognised. Optional so test stubs and
	 * older models remain valid; the SSE client feature-tests.
	 * `opts.remote` carries the fleet CRDT stamp (timestamp + sourceId) for
	 * LWW merge; omit it for local writes, which stamp with the wall-clock.
	 */
	applyConfigPatch?(path: string, value: unknown, opts?: ConfigPatchOpts): boolean;
	/** Observability sink — optional. */
	telemetry?: Telemetry;
}

/** Flat admin-pushable config DTO (legacy v1). Decomposed into typed setter calls in the fleet client. */
export interface DisplayConfig {
	altitude?: number;
	timeOfDay?: number;
	weather?: WeatherType;
	cloudDensity?: number;
	flightSpeed?: number;
	syncToRealTime?: boolean;
	showClouds?: boolean;
	nightLightIntensity?: number;
	qualityMode?: QualityMode;
}

export interface DeviceInfo {
	deviceId: string;
	hostname: string;
	currentMode: DisplayMode;
	currentLocation: LocationId;
	fps: number;
	uptime: number;
	lastSeen: number;
	online: boolean;
	/** Optional hardening fields relayed from DeviceStatus (see below). */
	commit?: string;
	errorCount?: number;
	lastErrors?: string[];
}

export interface DeviceStatus {
	deviceId: string;
	hostname: string;
	fps: number;
	mode: DisplayMode;
	location: LocationId;
	weather: WeatherType;
	uptime: number;
	lastSeen: number;
	// ── Production-hardening additions (all OPTIONAL — flat-DTO invariant #2:
	// extend additively, never reshape; fielded Pis decode older payloads). ──
	/** Build commit sha the device is running ($lib/version APP_COMMIT). */
	commit?: string;
	/** Worst-case frame rate (from the p95 frame period) — the stutter floor. */
	fpsLow?: number;
	/** Rolling wall-clock frame-period percentiles, ms. `fps` is 1000/frameMsP50. */
	frameMsP50?: number;
	frameMsP95?: number;
	/** Model simulation-step CPU cost, ms. NOT a frame rate — it excludes all
	 *  rendering, so it reads ~0.2 ms while the panel runs at ~3 fps. */
	tickMsP50?: number;
	/** Total telemetry error-event count since boot. */
	errorCount?: number;
	/** Up to the 3 most recent error messages (truncated) — enough to know
	 *  WHAT is failing on a fielded Pi without SSH. */
	lastErrors?: string[];
}

/** Returned by GET /api/fleet/heartbeat?summary — rollup across the fleet. */
export interface FleetSummary {
	total: number;
	online: number;
	offline: number;
	avgFps: number;
	maxTempC: number;
	totalCrashes: number;
}

// ─── Shared fleet cadences ─────────────────────────────────────────────────
// SSOT for "how often does each device poll." Must match mDNS announce interval.

export const STATUS_INTERVAL_MS = 5000;
export const PEER_REFRESH_INTERVAL_MS = 30_000;
export const ONLINE_THRESHOLD_MS = 3 * 60_000;

/**
 * How far ahead the leader schedules a synchronised transition. The window
 * absorbs ~±200 ms of NTP drift across the panorama. SSOT for both the sender
 * (AeroWindow's director broadcast) and the receiver's sanity bound below.
 */
export const TRANSITION_DELAY_MS = 2500;

/**
 * Upper bound on how far in the future a peer may schedule us. Generous
 * relative to TRANSITION_DELAY_MS so ordinary clock skew still lands, but
 * bounded.
 */
export const MAX_TRANSITION_LEAD_MS = 60_000;

/**
 * Convert a peer's absolute `transitionAtMs` into a setTimeout delay that is
 * always sane.
 *
 * Two failure modes this exists to prevent, both from a peer whose clock is
 * wrong (dead RTC, pre-NTP boot) rather than from malice:
 *
 *  - FAR FUTURE: a delay above 2^31-1 ms overflows setTimeout's 32-bit field
 *    and the callback fires IMMEDIATELY — the opposite of the intent, and it
 *    desynchronises the panorama at the exact moment the schedule exists to
 *    keep it together. Anything merely large (an hour, a day) would instead
 *    freeze that Pi's scene until the timer eventually resolved.
 *  - PAST: already-late decisions should apply now, not schedule negatively.
 *
 * Returns a delay in [0, MAX_TRANSITION_LEAD_MS].
 */
export function transitionDelayMs(transitionAtMs: number, now: number = Date.now()): number {
	if (!Number.isFinite(transitionAtMs)) return 0;
	const delay = transitionAtMs - now;
	if (delay <= 0) return 0;
	return Math.min(delay, MAX_TRANSITION_LEAD_MS);
}

// ─── Peer URL helper ───────────────────────────────────────────────────────

export interface PeerLike { host: string; port: number; self?: boolean; }

export function urlFor(peer: PeerLike): string {
	if (peer.self && typeof window !== 'undefined') return window.location.origin;
	const proto = typeof window !== 'undefined' ? window.location.protocol : 'http:';
	return `${proto}//${peer.host}:${peer.port}`;
}
