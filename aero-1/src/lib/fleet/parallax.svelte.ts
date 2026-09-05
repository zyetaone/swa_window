import { hashString } from '$lib/world/prng';
/**
 * Corridor — device-fingerprint → (role, groupId) binding resolver.
 *
 * Southwest Airlines deployment: two 3-pane corridors (6 Waveshare 21.5"
 * touchscreens total). Each corridor = 3 Pis side-by-side, ~1m apart, forming
 * one continuous airplane window onto the SAME flight. Groups share altitude /
 * heading / weather / location / time; each pane has a unique camera yaw.
 *
 * Resolution priority (highest → lowest):
 *   1. URL params      ?role=left|center|right|solo  &group=lefthall
 *   2. localStorage    aero.device.binding (keyed by fingerprint)
 *   3. localStorage    aero.device.binding (self JSON) / legacy aero.device.role
 *   4. Default         { role: 'solo', groupId: 'default' }
 *
 * This module is the SSOT for role+group. Kiosk boot (`+page.svelte`) must
 * call `resolveBinding()` and mirror `role` into `camera.parallax.role` —
 * do not re-read URL/localStorage with a second key for the same decision.
 *
 * Fingerprint is derived on-device only — never sent upstream. It's used as the
 * localStorage key so a device keeps its binding across browser restarts even
 * when MAC / LAN changes (e.g. kiosk re-image).
 */
import { isValidDeviceRole, type DeviceRole } from '$lib/types';
export type { DeviceRole };

export interface DeviceBinding {
	role: DeviceRole;
	groupId: string;
}

const STORAGE_KEY_BINDINGS = 'aero.device.bindings'; // map: fingerprint → binding
const STORAGE_KEY_SELF = 'aero.device.binding';      // resolved binding for THIS device
const STORAGE_KEY_FP = 'aero.device.fingerprint';
/** Pre-binding-era key written by older +page boot. Migrated once into SELF. */
const STORAGE_KEY_LEGACY_ROLE = 'aero.device.role';


/**
 * Device fingerprint — stable string derived from UA + screen + timezone.
 * Cached in localStorage so hash never drifts on the same device.
 */
export function getDeviceFingerprint(): string {
	if (typeof window === 'undefined') return 'ssr';
	const cached = window.localStorage.getItem(STORAGE_KEY_FP);
	if (cached) return cached;
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
	const raw = `${navigator.userAgent}|${window.screen.width}x${window.screen.height}|${tz}`;
	const fp = hashString(raw).toString(16).padStart(8, '0');
	window.localStorage.setItem(STORAGE_KEY_FP, fp);
	return fp;
}

function readBindingsMap(): Record<string, DeviceBinding> {
	if (typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY_BINDINGS);
		return raw ? (JSON.parse(raw) as Record<string, DeviceBinding>) : {};
	} catch {
		return {};
	}
}

function writeBindingsMap(map: Record<string, DeviceBinding>): void {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(STORAGE_KEY_BINDINGS, JSON.stringify(map));
}


/**
 * Resolve this device's binding. NOT pure: the URL-param branch persists the
 * resolved binding under STORAGE_KEY_SELF (and into the fingerprint map) so a
 * subsequent load without URL params still reflects the operator's choice.
 * Still safe to call from $effect or component setup — writes are idempotent.
 */
export function resolveBinding(): DeviceBinding {
	if (typeof window === 'undefined') return { role: 'solo', groupId: 'default' };

	// 1. URL param wins — matches existing ?role= behavior in prod.
	const params = new URLSearchParams(window.location.search);
	const urlRole = params.get('role');
	const urlGroup = params.get('group');
	if (isValidDeviceRole(urlRole)) {
		const binding: DeviceBinding = { role: urlRole, groupId: urlGroup || 'default' };
		window.localStorage.setItem(STORAGE_KEY_SELF, JSON.stringify(binding));
		// Also remember by fingerprint so admin-assigned bindings survive.
		const map = readBindingsMap();
		map[getDeviceFingerprint()] = binding;
		writeBindingsMap(map);
		return binding;
	}

	// 2. fingerprint-keyed map (admin-assigned bindings survive reboots).
	const map = readBindingsMap();
	const fpBinding = map[getDeviceFingerprint()];
	if (fpBinding && isValidDeviceRole(fpBinding.role)) return fpBinding;

	// 3. Single self-binding (older path, kept for back-compat).
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY_SELF);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<DeviceBinding>;
			if (isValidDeviceRole(parsed.role)) {
				return { role: parsed.role, groupId: parsed.groupId || 'default' };
			}
		}
	} catch { /* fall through */ }

	// 4. Legacy role-only key from pre-binding +page boot. Promote into the
	// self-binding slot so subsequent boots hit step 3 and ROLE_KEY can die.
	const legacyRole = window.localStorage.getItem(STORAGE_KEY_LEGACY_ROLE);
	if (isValidDeviceRole(legacyRole)) {
		const binding: DeviceBinding = { role: legacyRole, groupId: 'default' };
		window.localStorage.setItem(STORAGE_KEY_SELF, JSON.stringify(binding));
		window.localStorage.removeItem(STORAGE_KEY_LEGACY_ROLE);
		return binding;
	}

	return { role: 'solo', groupId: 'default' };
}

/**
 * Persist a binding for a specific fingerprint (admin panel uses this).
 * If the fingerprint matches THIS device, also updates self-binding.
 */
export function saveBinding(fingerprint: string, binding: DeviceBinding): void {
	if (typeof window === 'undefined') return;
	if (!isValidDeviceRole(binding.role)) return;
	const map = readBindingsMap();
	map[fingerprint] = binding;
	writeBindingsMap(map);
	if (fingerprint === getDeviceFingerprint()) {
		window.localStorage.setItem(STORAGE_KEY_SELF, JSON.stringify(binding));
	}
}

/**
 * Forget a stored binding. The admin panel used to reach past this module and
 * hand-roll localStorage against a copy of the key string — which meant
 * renaming STORAGE_KEY_BINDINGS here would silently break deletion there.
 */
export function deleteBinding(fingerprint: string): void {
	if (typeof window === 'undefined') return;
	const map = readBindingsMap();
	if (!(fingerprint in map)) return;
	delete map[fingerprint];
	writeBindingsMap(map);
	if (fingerprint === getDeviceFingerprint()) {
		window.localStorage.removeItem(STORAGE_KEY_SELF);
	}
}

/** List every stored binding (for admin UI). */
export function listBindings(): Array<{ fingerprint: string; binding: DeviceBinding }> {
	const map = readBindingsMap();
	return Object.entries(map).map(([fingerprint, binding]) => ({ fingerprint, binding }));
}

/**
 * Is this device the leader of its group? Center + solo rotate locally;
 * left/right panes follow director_decision from the leader.
 */
export function isGroupLeader(role: DeviceRole): boolean {
	return role === 'center' || role === 'solo';
}

/**
 * Edge pane of a 3-Pi corridor. Shares the flight scene with center but must
 * not paint operator/passenger chrome that would read as three separate UIs.
 * SSOT for shell gates — do not re-inline `role === 'left' || role === 'right'`.
 */
export function isEdgePane(role: DeviceRole): boolean {
	return role === 'left' || role === 'right';
}

/**
 * Operator SidePanel tab + settings chrome.
 *
 * ?ops=1 in production; always on in dev.
 *
 * This used to be `opsMode || isGroupLeader(role)`, which meant a solo install
 * — and the centre pane of every corridor — carried a visible chevron on the
 * glass 24/7. On a display whose whole premise is that you cannot tell it is a
 * computer, that is a permanent tell, and eventually someone walking past taps
 * it and finds sliders labelled "VIIRS Brightness". It also made the centre
 * pane differ from its two neighbours, breaking the one-continuous-window
 * illusion at the seam.
 *
 * Role is no longer a factor: an on-site tech reaches the panel the same way
 * on every pane, which is one rule to document instead of three. `isDev` keeps
 * the panel one keystroke away while developing, where there is no audience to
 * break the fiction for.
 */
export function showsOpsChrome(opsMode = false, isDev = false): boolean {
	return opsMode || isDev;
}

/**
 * Open-blind passenger whisper ("En route / place"). Never on edge panes —
 * one continuous window. Closed-blind BlindInfoCard is independent furniture
 * and may show on every pane.
 */
export function showsOpenPassengerHud(role: DeviceRole, hudVisible: boolean): boolean {
	return hudVisible && isGroupLeader(role);
}

/**
 * Parse ?ops=1|true from a search string or URLSearchParams.
 * Used by SidePanel; pure so tests don't need a real location object.
 */
export function isOpsModeParam(search: string | URLSearchParams | null | undefined): boolean {
	if (search == null) return false;
	const params =
		typeof search === 'string'
			? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
			: search;
	const v = params.get('ops');
	return v === '1' || v === 'true';
}

/**
 * Should this device apply a director_decision message? True when the message's
 * groupId matches our group, or the message targets a wildcard group ('*').
 */
export function shouldApplyDirectorDecision(
	myGroupId: string,
	msgGroupId: string | undefined,
): boolean {
	if (!msgGroupId) return true; // legacy / unscoped broadcast
	if (msgGroupId === '*') return true;
	return msgGroupId === myGroupId;
}
