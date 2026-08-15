/**
 * Peer-sync ambient paths — SSOT for admin→fleet ambient config sync AND
 * kiosk reboot persistence.
 *
 * Lives in `model/` (not `fleet/peer-sync.svelte.ts`, which re-exports
 * PEER_SYNC_PATHS) so `model/persistence.ts` can validate restored values
 * without importing a rune/fleet module — persistence must stay pure data
 * (see its header). Add a path here when a shared panel gains a new patch
 * target; keep PEER_SYNC_PATHS alphabetical by namespace so diffs stay
 * readable.
 *
 * Device-local chrome (role FOV, etc.) stays out of this list.
 *
 * Daisy-chain (fleet wall = one display system): `world.useThreeOverlay` and
 * `world.qualityMode` stay in this list AND in AMBIENT_PERSIST so one pane's
 * lighting tier fans out and survives reboot — like monitors on a shared
 * video chain. See docs/SIMPLIFICATION-DECISIONS.md.
 */
import { QUALITY_MODES } from '$lib/types';

export const PEER_SYNC_PATHS = [
	'atmosphere.clouds.density',
	'atmosphere.clouds.speed',
	'atmosphere.haze.amount',
	'director.autopilot.nightLitCitiesOnly',
	'shell.clockVisible',
	'shell.hudVisible',
	'shell.mouseParallax',
	'shell.touchEnabled',
	'shell.windowFrame',
	'world.additiveStrength',
	'world.buildingsEnabled',
	'world.moonlightIntensity',
	'world.nightExposure',
	'world.nightLightIntensity',
	'world.qualityMode',
	'world.showClouds',
	'world.skyDarken',
	'world.useCesiumClouds',
	'world.useHashPalette',
	'world.useThreeOverlay',
	'world.viirsBrightness',
	'world.wingDriftSign',
	'world.wingXBase',
] as const;

export type PeerSyncPath = (typeof PEER_SYNC_PATHS)[number];

/** Leaf types that cross the peer-sync / persistence wire. */
export type AmbientValue = number | boolean | string;

type AmbientPathSpec =
	| { kind: 'boolean' }
	| { kind: 'number'; min: number; max: number }
	| { kind: 'enum'; values: readonly AmbientValue[] };

/**
 * Per-path validation for values restored from localStorage. Bounds mirror
 * the admin panel slider ranges (AtmosphereControls / LightingControls) —
 * clamped, not rejected, matching persistence.ts's safeNum style. Booleans
 * and enums are dropped when invalid. `satisfies` ties the spec keys to
 * PEER_SYNC_PATHS so a new path fails to compile without a spec.
 */
export const AMBIENT_PATH_SPECS = {
	'atmosphere.clouds.density': { kind: 'number', min: 0, max: 1 },
	'atmosphere.clouds.speed': { kind: 'number', min: 0.1, max: 3 },
	'atmosphere.haze.amount': { kind: 'number', min: 0, max: 0.15 },
	'director.autopilot.nightLitCitiesOnly': { kind: 'boolean' },
	'shell.clockVisible': { kind: 'boolean' },
	'shell.hudVisible': { kind: 'boolean' },
	'shell.mouseParallax': { kind: 'boolean' },
	'shell.touchEnabled': { kind: 'boolean' },
	'shell.windowFrame': { kind: 'boolean' },
	'world.additiveStrength': { kind: 'number', min: 0, max: 15 },
	'world.buildingsEnabled': { kind: 'boolean' },
	'world.moonlightIntensity': { kind: 'number', min: 0, max: 1 },
	'world.nightExposure': { kind: 'number', min: 0.4, max: 1.5 },
	'world.nightLightIntensity': { kind: 'number', min: 0, max: 5 },
	'world.qualityMode': { kind: 'enum', values: QUALITY_MODES },
	'world.showClouds': { kind: 'boolean' },
	'world.skyDarken': { kind: 'number', min: 0.5, max: 4 },
	'world.useCesiumClouds': { kind: 'boolean' },
	'world.useHashPalette': { kind: 'boolean' },
	'world.useThreeOverlay': { kind: 'boolean' },
	'world.viirsBrightness': { kind: 'number', min: 0.5, max: 3 },
	'world.wingDriftSign': { kind: 'enum', values: [-1, 1] },
	'world.wingXBase': { kind: 'number', min: -12, max: 2 },
} as const satisfies Record<PeerSyncPath, AmbientPathSpec>;

/**
 * Paths persisted under `PersistedState.ambient` — every peer-sync path
 * EXCEPT the three covered by PersistedState's legacy named fields
 * (`cloudDensity`, `buildingsEnabled`, `showClouds`). Storing those twice
 * would give the restore path two competing sources for one leaf.
 *
 * ─── AND EXCEPT `shell.windowFrame`, WHICH MUST RESET EVERY BOOT ────────────
 * The distinction this list should encode is between SITE TUNING and MODES.
 *
 * Site tuning — night-light intensity, haze, quality — is work an operator did
 * deliberately for this room, and losing it on reboot would mean redoing that
 * work. It belongs here.
 *
 * `shell.windowFrame` is a mode with one known-good state. The wall's frame is
 * PHYSICAL: the Waveshare bezel is the window surround, so drawing the oval on
 * top of it gives a doubled frame. Persisting the toggle meant one operator
 * tapping it once — or one stale value synced from a peer — left the wall wrong
 * through every future reboot, and changing the code default could never undo
 * it, because the stored value is applied after the default.
 *
 * Still peer-synced, so admin can toggle it live fleet-wide for a demo. It just
 * no longer outlives the session that set it.
 */
export const AMBIENT_PERSIST_PATHS: readonly PeerSyncPath[] = PEER_SYNC_PATHS.filter(
	(p) => p !== 'atmosphere.clouds.density'
		&& p !== 'world.buildingsEnabled'
		&& p !== 'world.showClouds'
		&& p !== 'shell.windowFrame',
);

/**
 * Validate a persisted ambient value against its spec. Returns the
 * (possibly clamped) value, or undefined to drop it — never trust
 * localStorage verbatim.
 */
export function validateAmbientValue(path: PeerSyncPath, value: unknown): AmbientValue | undefined {
	// Widen the const-literal spec to AmbientPathSpec so `values.includes`
	// accepts any AmbientValue (the literal tuple types would reject it).
	const spec = AMBIENT_PATH_SPECS[path] as AmbientPathSpec;
	switch (spec.kind) {
		case 'boolean':
			return typeof value === 'boolean' ? value : undefined;
		case 'number': {
			if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
			return Math.min(spec.max, Math.max(spec.min, value));
		}
		case 'enum':
			return spec.values.includes(value as AmbientValue) ? (value as AmbientValue) : undefined;
	}
}
