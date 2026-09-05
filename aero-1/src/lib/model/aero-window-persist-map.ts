/**
 * Persistence map helpers for AeroWindow.
 *
 * Maps between localStorage blobs (`persistence.ts`) and live model fields.
 * Class keeps `$state` ownership; this module only writes through a host.
 * Boot restore stays unstamped for CRDT LWW — caller's applyConfigPatch must
 * honour `#booting` (stamp:false).
 */
import { readByPath } from '$lib/utils';
import {
	AMBIENT_PERSIST_PATHS,
	type AmbientValue,
	type PeerSyncPath,
} from '$lib/model/peer-sync-paths';
import type { PersistedState } from '$lib/model/persistence';

/** Surface needed to restore a saved session onto the live model. */
export interface PersistRestoreHost {
	config: {
		camera: { altitude: { min: number; max: number } };
	};
	flight: {
		setAltitude(alt: number, bounds: { min: number; max: number }): void;
	};
	applyConfigPatch(path: string, value: unknown): boolean;
}

/** Surface needed to snapshot live state for localStorage. */
export interface PersistSnapshotHost {
	config: {
		atmosphere: { clouds: { density: number } };
		// Extra keys are REQUIRED, not incidental: the two named fields are read
		// directly, but every other world.* leaf is reached generically through
		// AMBIENT_PERSIST_PATHS + readByPath. Pinning this to the two named
		// properties made any realistic caller — and the test — a type error,
		// while the function itself was always designed to walk the whole tree.
		world: { buildingsEnabled: boolean; showClouds: boolean } & Record<string, unknown>;
	} & Record<string, unknown>;
	flight: { altitude: number };
}

/**
 * Apply a loaded blob onto the host.
 * location / weather / syncToRealTime are intentionally ignored (boot policy).
 */
export function applyPersistedToHost(
	host: PersistRestoreHost,
	saved: Partial<PersistedState>,
): void {
	if (saved.altitude !== undefined) {
		// Engine clamp only — do not arm the 8 s user-override (setAltitude).
		const { min, max } = host.config.camera.altitude;
		host.flight.setAltitude(saved.altitude, { min, max });
	}
	if (saved.cloudDensity !== undefined) {
		host.applyConfigPatch('atmosphere.clouds.density', saved.cloudDensity);
	}
	if (saved.buildingsEnabled !== undefined) {
		host.applyConfigPatch('world.buildingsEnabled', saved.buildingsEnabled);
	}
	if (saved.showClouds !== undefined) {
		host.applyConfigPatch('world.showClouds', saved.showClouds);
	}
	if (saved.ambient) {
		for (const [path, value] of Object.entries(saved.ambient)) {
			host.applyConfigPatch(path, value);
		}
	}
}

/** Build the blob written by +page.svelte auto-save. */
export function buildPersistedSnapshot(host: PersistSnapshotHost): PersistedState {
	const ambient: Partial<Record<PeerSyncPath, AmbientValue>> = {};
	const root = host.config as unknown as Record<string, unknown>;
	for (const path of AMBIENT_PERSIST_PATHS) {
		const value = readByPath(root, path);
		if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
			ambient[path] = value;
		}
	}
	return {
		// location/weather omitted — load never restores them; boot rotates.
		altitude: host.flight.altitude,
		cloudDensity: host.config.atmosphere.clouds.density,
		buildingsEnabled: host.config.world.buildingsEnabled,
		showClouds: host.config.world.showClouds,
		// syncToRealTime omitted — never persisted (boot always Real Time ON).
		ambient,
	};
}
