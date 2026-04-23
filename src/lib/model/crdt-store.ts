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

import { setByPath } from './config-tree.svelte';

export interface CRDTPatch {
	path: string;
	value: unknown;
	timestamp: number;
	sourceId: string;
}

export interface CRDTEntry {
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
	 */
	set(path: string, value: unknown): boolean {
		this.#timestamps.set(path, { value, timestamp: Date.now(), sourceId: _deviceId });
		setByPath(this.#root, path, value);
		return true;
	}

	/**
	 * Tiebreak on equal timestamps by sourceId (lexicographic). Ensures
	 * two devices receiving the same pair of concurrent writes in
	 * different orders converge to the same winner.
	 */
	canMerge(patch: CRDTPatch): boolean {
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

	mergeBatch(patches: CRDTPatch[]): number {
		let applied = 0;
		for (const patch of patches) {
			if (this.merge(patch)) applied++;
		}
		return applied;
	}

	snapshot(): Record<string, CRDTEntry> {
		return Object.fromEntries(this.#timestamps);
	}

	restore(snap: Record<string, CRDTEntry>): void {
		for (const [path, entry] of Object.entries(snap)) {
			this.#timestamps.set(path, entry as CRDTEntry);
			setByPath(this.#root, path, entry.value);
		}
	}

	reset(): void {
		this.#timestamps.clear();
	}
}

let _deviceId = 'local';

export function setCRDTDeviceId(id: string): void {
	_deviceId = id;
}

export function getCRDTDeviceId(): string {
	return _deviceId;
}

export function createCRDTStore(root: Record<string, unknown>): CRDTStore {
	return new CRDTStore(root);
}
