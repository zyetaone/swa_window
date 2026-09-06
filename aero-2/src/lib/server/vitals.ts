/**
 * Render vitals this pane's BROWSER measured, held for the status endpoint.
 *
 * `fps` is measured in the render loop and lives only in the tab. Everything
 * that wants it lives elsewhere: `health-check.sh` scrapes `GET /api/status`
 * every 60 s and POSTs the result to the admin, which averages it across the
 * wall. Server-side there is no way to observe a frame, so without a path from
 * the tab to the server that whole chain reports nothing.
 *
 * And it did. `HeartbeatSample.fps` is optional precisely because aero-2's
 * `/api/status` never carried one — the field was declared, parsed, averaged,
 * and rendered as an em-dash on every device in the cockpit, permanently. That
 * is this repo's "packaged and inert" pattern: a feature that is fully built
 * except for the one wire that would make it do something.
 *
 * MODULE STATE, not a store or a file. It is one number per process, it is
 * worthless after a restart (a stale fps is worse than none), and the tab
 * refreshes it every few seconds. Writing it to disk would buy persistence
 * nobody wants and add an I/O failure mode to a health endpoint.
 *
 * Staleness is the caller's problem to see, not this module's to hide, so the
 * reader gets the age alongside the value and decides. A pane that stopped
 * reporting an hour ago must not look like a pane running at 60 fps.
 */

interface Vitals {
	fps: number;
	frameTimeMs: number;
	atMs: number;
}

let latest: Vitals | null = null;

/** Newer than this and the reading is trusted; older and it is not reported. */
export const VITALS_MAX_AGE_MS = 30_000;

export function recordVitals(fps: number, frameTimeMs: number, nowMs = Date.now()): void {
	if (!Number.isFinite(fps) || fps < 0) return;
	latest = { fps, frameTimeMs, atMs: nowMs };
}

/**
 * The current reading, or null when there is none or it has gone stale.
 *
 * Null rather than 0, and the distinction is the same one `HeartbeatSample`
 * already makes: 0 means "this renderer is stalled", which is a real and
 * alarming measurement. "Nobody has told us" must not be reported as that.
 */
export function readVitals(nowMs = Date.now()): { fps: number; frameTimeMs: number } | null {
	if (!latest) return null;
	if (nowMs - latest.atMs > VITALS_MAX_AGE_MS) return null;
	return { fps: latest.fps, frameTimeMs: latest.frameTimeMs };
}

/** Test seam. */
export function resetVitals(): void {
	latest = null;
}
