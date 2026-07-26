/**
 * CRDTStore — last-writer-wins timestamp index over the config tree.
 *
 * Tracks timestamps for every config mutation. Fleet patches carry
 * { path, value, timestamp }. Incoming patches apply only when
 * timestamp > local recorded timestamp. Local UI calls .set() which
 * writes through to the config tree and records the timestamp.
 *
 * Usage:
 *   const crdt = createCRDTStore(config);
 *   crdt.set('atmosphere.clouds.density', 0.5);   // local UI
 *   crdt.merge({ path, value, timestamp, sourceId }); // fleet
 */

import { setByPath } from '$lib/utils';

/**
 * Sanity floor — reject any timestamp before 2024-01-01T00:00:00Z.
 * Protects against Pi devices with dead RTC batteries booting into 1970
 * and blanking the fleet config with "oldest" timestamps.
 * 1704067200000 = Date.UTC(2024, 0, 1)
 */
const MIN_SANE_TIMESTAMP = 1704067200000;

export interface CRDTPatch {
	path: string;
	value: unknown;
	timestamp: number;
	sourceId: string;
}

interface CRDTEntry {
	value: unknown;
	timestamp: number;
	sourceId: string;
}

export class CRDTStore {
	#timestamps = new Map<string, CRDTEntry>();
	readonly #root: Record<string, unknown>;

	constructor(root: Record<string, unknown>) {
		this.#root = root;
	}

	get(path: string): CRDTEntry | undefined {
		return this.#timestamps.get(path);
	}

	/**
	 * Local write — stamps with Date.now() (wall-clock) and the current
	 * device id. Wall-clock is comparable across devices; NTP drift is
	 * an accepted risk. For LWW on concurrent admin pushes, this is the
	 * right primitive — lamport/vector clocks would be overkill.
	 *
	 * If Date.now() is below MIN_SANE_TIMESTAMP the write still stamps —
	 * a console.error fires but we don't block the local user (better a
	 * mis-stamped local write than a frozen UI). NTP will fix the clock
	 * shortly and subsequent stamps will be healthy.
	 */
	set(path: string, value: unknown): boolean {
		const ts = Date.now();
		if (ts < MIN_SANE_TIMESTAMP) {
			console.error(`[crdt] System clock appears incorrect (${ts} < ${MIN_SANE_TIMESTAMP}). Local writes will lose CRDT races until NTP syncs.`);
		}
		this.#timestamps.set(path, { value, timestamp: ts, sourceId: _deviceId });
		setByPath(this.#root, path, value);
		return true;
	}

	/**
	 * Tiebreak on equal timestamps by sourceId (lexicographic). Ensures
	 * two devices receiving the same pair of concurrent writes in
	 * different orders converge to the same winner.
	 *
	 * Patches with timestamps below MIN_SANE_TIMESTAMP are rejected —
	 * they indicate a peer with a dead RTC or unset clock.
	 */
	canMerge(patch: CRDTPatch): boolean {
		if (patch.timestamp < MIN_SANE_TIMESTAMP) return false;
		const local = this.#timestamps.get(patch.path);
		if (!local) return true;
		if (patch.timestamp > local.timestamp) return true;
		if (patch.timestamp < local.timestamp) return false;
		return patch.sourceId > local.sourceId;
	}

	merge(patch: CRDTPatch): boolean {
		if (!this.canMerge(patch)) return false;
		this.#timestamps.set(patch.path, { value: patch.value, timestamp: patch.timestamp, sourceId: patch.sourceId });
		setByPath(this.#root, patch.path, patch.value);
		return true;
	}
}

let _deviceId = 'local';

export function setCRDTDeviceId(id: string): void {
	_deviceId = id;
}

export function getCRDTDeviceId(): string {
	return _deviceId;
}

