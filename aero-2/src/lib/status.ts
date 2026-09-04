/**
 * status.ts — the shape of GET /api/status, declared once.
 *
 * It was declared three times: the endpoint's `json({...})` literal, and an
 * `interface NetworkStatus` hand-copied into BOTH /admin and the operator
 * drawer. That is not a tidiness complaint. The /admin copy drifted to a shape
 * the endpoint never sent (`version`, `memory`, `network`), so
 * `status.memory.heapUsedMb` threw during component init, and a throw in init
 * renders an EMPTY BODY -- /admin served 200 OK with 19 characters in it, with
 * nothing in the console but a client-side error nobody was watching.
 *
 * Now the endpoint writes `satisfies KioskStatus` and both readers import this
 * type, so the same drift is a failed `svelte-check`, not a blank kiosk page.
 */
export interface KioskStatus {
	online: boolean;
	hostname: string;
	uptimeSec: number;
	freeMemBytes: number;
	totalMemBytes: number;
	lanIps: { name: string; address: string; family: string }[];
	primaryLanIp: string;
	port: number;
}

/**
 * Fetch it, or throw with a message worth showing.
 *
 * Both callers used to roll their own. The drawer's version checked `res.ok`,
 * aborted on teardown and surfaced the failure; /admin's did none of that, so a
 * 500 became `undefined` fields rendered as blanks -- an unreachable Pi looked
 * like a reachable one with nothing to say. One implementation, the careful one.
 */
export async function fetchStatus(signal?: AbortSignal): Promise<KioskStatus> {
	const res = await fetch('/api/status', { signal });
	if (!res.ok) throw new Error(`/api/status returned ${res.status}`);
	return (await res.json()) as KioskStatus;
}

/**
 * One device's line in the fleet rollup, as `GET /api/fleet/heartbeat` serves
 * it. Mirrors `HeartbeatSample` minus `lastError`, which that route withholds
 * from unauthenticated readers.
 *
 * Declared here rather than imported from `lib/server/heartbeat.ts` because a
 * browser bundle must not pull in a module that reads `process.env` and holds
 * the fleet's Map. `status.ts` is already the shared shape file for exactly
 * this reason — see the note above `KioskStatus`, where three hand-copied
 * declarations of one response drifted and rendered /admin blank.
 */
export interface FleetDevice {
	deviceId: string;
	role: string;
	groupId: string;
	fps?: number;
	tempC?: number;
	uptimeSec: number;
	crashCount: number;
	commit?: string;
	mode?: string;
	throttledRaw?: number;
	thermalAction?: 'ok' | 'shed';
	clockSynced?: boolean;
	receivedAtMs: number;
}

/** Two missed 60 s beats plus slack — must match ONLINE_WINDOW_MS server-side. */
export const FLEET_ONLINE_WINDOW_MS = 150_000;

export async function fetchFleet(signal?: AbortSignal): Promise<FleetDevice[]> {
	const res = await fetch('/api/fleet/heartbeat', { signal });
	if (!res.ok) throw new Error(`/api/fleet/heartbeat returned ${res.status}`);
	return (await res.json()) as FleetDevice[];
}
