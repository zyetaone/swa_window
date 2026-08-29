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
