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
import { isValidTimeZone } from './local-time';

export const PEER_SYNC_PATHS = [
	'atmosphere.clouds.density',
	'atmosphere.clouds.speed',
	'atmosphere.haze.amount',
	'audio.enabled',
	'audio.engineVolume',
	'audio.masterVolume',
	'audio.musicUrl',
	'audio.musicVolume',
	'audio.weatherVolume',
	'director.autopilot.nightLitCitiesOnly',
	'director.daylight.timeZoneOverride',
	'shell.clockVisible',
	'shell.hudVisible',
	'shell.mouseParallax',
	'shell.touchEnabled',
	'shell.windowFrame',
	'world.additiveStrength',
	'world.bloomSigma',
	'world.buildingsEnabled',
	'world.moonlightIntensity',
	'world.nightExposure',
	'world.nightLightIntensity',
	'world.nightMaskGamma',
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
	| { kind: 'enum'; values: readonly AmbientValue[] }
	| { kind: 'url'; maxLength: number }
	| { kind: 'zone' };

/**
 * Per-path validation for values restored from localStorage. Bounds mirror
 * the admin panel slider ranges (AtmosphereControls / LightingControls) —
 * clamped, not rejected, matching persistence.ts's safeNum style. Booleans
 * and enums are dropped when invalid. `satisfies` ties the spec keys to
 * PEER_SYNC_PATHS so a new path fails to compile without a spec.
 *
 * ─── ⚠ THESE BOUNDS ARE RESTATED, NOT IMPORTED, AND THAT IS ON PURPOSE ──────
 * The obvious dedupe — read cfg.director.ambient.cloudSpeedMin etc. straight
 * from the config tree — is not available here: this module must stay pure
 * data so persistence.ts can validate without pulling in a rune module (see
 * the file header). So the numbers live in two places by necessity.
 *
 * They had already drifted. A bound WIDER than its slider is not a harmless
 * slack: validateAmbientValue accepts a restored or peer-synced value up to
 * the spec bound, so the wall can boot into a state no operator could dial in
 * and none of them can see is wrong. `moonlightIntensity` allowed 1.0 against
 * a 0.3 slider — a moon over 3x brighter than maximum — and `clouds.speed`
 * allowed 3.0 against a 1.5 slider. Same shape as the cruise maxSpeed bug:
 * two numbers that must agree, compared only at runtime, in one direction.
 *
 * tests/lib/model/peer-sync-paths asserts these against the config tree, which
 * a test CAN import. Change a slider bound and that test tells you to change
 * the spec too.
 */
export const AMBIENT_PATH_SPECS = {
	'atmosphere.clouds.density': { kind: 'number', min: 0, max: 1 },
	// director.ambient.cloudSpeedMin / cloudSpeedMax
	'atmosphere.clouds.speed': { kind: 'number', min: 0.2, max: 1.5 },
	'atmosphere.haze.amount': { kind: 'number', min: 0, max: 0.15 },
	'audio.enabled': { kind: 'boolean' },
	'audio.engineVolume': { kind: 'number', min: 0, max: 1 },
	'audio.masterVolume': { kind: 'number', min: 0, max: 1 },
	'audio.musicUrl': { kind: 'url', maxLength: 2048 },
	'audio.musicVolume': { kind: 'number', min: 0, max: 1 },
	'audio.weatherVolume': { kind: 'number', min: 0, max: 1 },
	'director.autopilot.nightLitCitiesOnly': { kind: 'boolean' },
	'director.daylight.timeZoneOverride': { kind: 'zone' },
	'shell.clockVisible': { kind: 'boolean' },
	'shell.hudVisible': { kind: 'boolean' },
	'shell.mouseParallax': { kind: 'boolean' },
	'shell.touchEnabled': { kind: 'boolean' },
	'shell.windowFrame': { kind: 'boolean' },
	'world.additiveStrength': { kind: 'number', min: 0, max: 15 },
	'world.bloomSigma': { kind: 'number', min: 1, max: 6 },
	'world.buildingsEnabled': { kind: 'boolean' },
	// LightingControls slider max. Floor stays 0 rather than the slider's
	// 0.035: a stored 0 means 'moon off', which is a reachable, harmless
	// state — the failure mode here is only ever too BRIGHT.
	'world.moonlightIntensity': { kind: 'number', min: 0, max: 0.3 },
	'world.nightExposure': { kind: 'number', min: 0.4, max: 1.5 },
	'world.nightLightIntensity': { kind: 'number', min: 0, max: 5 },
	'world.nightMaskGamma': { kind: 'number', min: 1, max: 3.5 },
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
		case 'url':
			return validateMediaUrl(value, spec.maxLength);
		case 'zone': {
			// '' = "follow the depicted location" — must round-trip like the
			// empty music URL. Anything else must be a real IANA zone id.
			if (typeof value !== 'string') return undefined;
			const tz = value.trim();
			return tz === '' || isValidTimeZone(tz) ? tz : undefined;
		}
	}
}

/**
 * The only string that crosses this wire, and it becomes an `Audio` src — so
 * it is a genuine trust boundary, not a formality. Both of its inputs are
 * attacker-reachable in the threat model this repo already assumes: any peer
 * on the LAN can PATCH /api/config, and localStorage survives whatever the
 * kiosk browser was pointed at before.
 *
 * Scheme allowlist rather than a blocklist: `javascript:` is the obvious one,
 * but `data:` and `blob:` are the ones a blocklist forgets, and both are
 * perfectly good ways to hand the kiosk arbitrary content. Only same-origin
 * relative paths and explicit http(s) survive.
 *
 * Protocol-relative `//host/x` is rejected too — it reads like a path but
 * resolves to a remote origin.
 */
function validateMediaUrl(value: unknown, maxLength: number): string | undefined {
	if (typeof value !== 'string') return undefined;
	const url = value.trim();
	if (url === '') return ''; // empty = "no music", the default; must round-trip
	if (url.length > maxLength) return undefined;
	// Control chars / stray whitespace can smuggle a scheme past a naive
	// prefix check — `java\nscript:` is the classic. Also drops embedded
	// spaces, which no legitimate URL needs unescaped.
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u0020\u007f]/.test(url)) return undefined;
	if (url.startsWith('//')) return undefined;
	if (url.startsWith('/')) return url; // same-origin, e.g. /media/bed.mp3
	return /^https?:\/\//i.test(url) ? url : undefined;
}
