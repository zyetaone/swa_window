/**
 * What the three panes agree on, and nothing else.
 *
 * ADR-007 rejected v1's CRDT: convergence by clock, not convergence by merge.
 * This module is the declarative half of that — the list of keys a wall push
 * may carry. Everything else on `PaneSettings` is pane-state BY OMISSION:
 * never listed here, never touched by the sync machinery, exactly as it behaves
 * today. v1 found this split by hand, one bypass at a time, when `setParallaxRole`
 * had to skip the CRDT stamp because a parallax role is device-local. Declaring
 * it once means the next such field needs no discovery.
 *
 * Lives at `lib/` root, not in `settings/`: `server/` imports nothing from a
 * feature slice (architecture §1) and both sides need this.
 */

export const WALL_KEYS = [
	'placeId',
	'presetId',
	'weather',
	'clockOffsetH',
	'displayMode',
	'blindOpen',
	'rotate'
] as const;

export type WallKey = (typeof WALL_KEYS)[number];

export interface WallState {
	placeId: string;
	presetId: string;
	weather: string;
	clockOffsetH: number;
	displayMode: string;
	blindOpen: boolean;
	rotate: boolean;
}

/** One push. `version` and `applyAtWallSec` are the server's to set, never a client's. */
export interface WallSnapshot {
	/**
	 * Ordering is a monotonic integer, not a timestamp. v1 ordered by wall clock
	 * and therefore needed a sanity floor against a Pi whose NTP had not settled;
	 * an integer the single writer increments has no such failure mode.
	 */
	version: number;
	/** The wall second at which every pane applies this, together. */
	applyAtWallSec: number;
	state: WallState;
}

/** Closed sets the server is allowed to know. See `parseWallState`. */
const WEATHERS = ['clear', 'cloudy', 'rain', 'overcast', 'storm'];
const DISPLAY_MODES = ['flight', 'video', 'screensaver', 'standby'];
const CLOCK_OFFSET_RANGE: readonly [number, number] = [-12, 12];

/**
 * Validate an untrusted body into a `WallState`, or null.
 *
 * `placeId` and `presetId` are checked as bounded identifier-shaped strings
 * rather than against the catalogs, deliberately: the catalogs live in
 * `settings/`, which `server/` must not import, and the client already resolves
 * an unknown id through `Location.byId`'s documented fallback. The server's job
 * here is to reject junk and cap size, not to own the catalog.
 */
export function parseWallState(input: unknown): WallState | null {
	if (typeof input !== 'object' || input === null) return null;
	const b = input as Record<string, unknown>;

	// A push is a whole snapshot. Per-field patches are the thing ADR-007 says
	// not to build — a partial write needs a merge rule, and a merge rule is the
	// CRDT growing back.
	for (const k of WALL_KEYS) if (!(k in b)) return null;

	const placeId = id(b.placeId);
	const presetId = id(b.presetId);
	if (placeId === null || presetId === null) return null;

	if (!WEATHERS.includes(b.weather as string)) return null;
	if (!DISPLAY_MODES.includes(b.displayMode as string)) return null;
	if (typeof b.blindOpen !== 'boolean' || typeof b.rotate !== 'boolean') return null;

	const clockOffsetH = b.clockOffsetH;
	if (
		typeof clockOffsetH !== 'number' ||
		!Number.isFinite(clockOffsetH) ||
		clockOffsetH < CLOCK_OFFSET_RANGE[0] ||
		clockOffsetH > CLOCK_OFFSET_RANGE[1]
	) {
		return null;
	}

	return {
		placeId,
		presetId,
		weather: b.weather as string,
		clockOffsetH,
		displayMode: b.displayMode as string,
		blindOpen: b.blindOpen,
		rotate: b.rotate
	};
}

/** Empty string is legal — it means "no preset pinned". */
function id(v: unknown): string | null {
	if (typeof v !== 'string' || v.length > 64) return null;
	return v === '' || /^[a-z0-9][a-z0-9-]*$/.test(v) ? v : null;
}
