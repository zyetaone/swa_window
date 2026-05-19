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
 *   3. Default         { role: 'solo', groupId: 'default' }
 *
 * Fingerprint is derived on-device only — never sent upstream. It's used as the
 * localStorage key so a device keeps its binding across browser restarts even
 * when MAC / LAN changes (e.g. kiosk re-image).
 */
import { DEVICE_ROLES, type DeviceRole } from '$lib/types';
export type { DeviceRole };

export interface DeviceBinding {
	role: DeviceRole;
	groupId: string;
}

const STORAGE_KEY_BINDINGS = 'aero.device.bindings'; // map: fingerprint → binding
const STORAGE_KEY_SELF = 'aero.device.binding';      // resolved binding for THIS device
const STORAGE_KEY_FP = 'aero.device.fingerprint';

const VALID_ROLES = new Set<DeviceRole>(DEVICE_ROLES);

/** Simple djb2 hash — stable across page reloads, no crypto overhead. */
function djb2(input: string): string {
	let h = 5381;
	for (let i = 0; i < input.length; i++) {
		h = ((h << 5) + h + input.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

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
	const fp = djb2(raw);
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

function isRole(v: unknown): v is DeviceRole {
	return typeof v === 'string' && VALID_ROLES.has(v as DeviceRole);
}

/**
 * Resolve this device's binding. Pure function — safe to call from $effect or
 * component setup. Persists the resolved binding under STORAGE_KEY_SELF so a
 * subsequent load without URL params still reflects the operator's choice.
 */
export function resolveBinding(): DeviceBinding {
	if (typeof window === 'undefined') return { role: 'solo', groupId: 'default' };

	// 1. URL param wins — matches existing ?role= behavior in prod.
	const params = new URLSearchParams(window.location.search);
	const urlRole = params.get('role');
	const urlGroup = params.get('group');
	if (isRole(urlRole)) {
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
	if (fpBinding && isRole(fpBinding.role)) return fpBinding;

	// 3. Single self-binding (older path, kept for back-compat).
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY_SELF);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<DeviceBinding>;
			if (isRole(parsed.role)) {
				return { role: parsed.role, groupId: parsed.groupId || 'default' };
			}
		}
	} catch { /* fall through */ }

	return { role: 'solo', groupId: 'default' };
}

/**
 * Persist a binding for a specific fingerprint (admin panel uses this).
 * If the fingerprint matches THIS device, also updates self-binding.
 */
export function saveBinding(fingerprint: string, binding: DeviceBinding): void {
	if (typeof window === 'undefined') return;
	if (!isRole(binding.role)) return;
	const map = readBindingsMap();
	map[fingerprint] = binding;
	writeBindingsMap(map);
	if (fingerprint === getDeviceFingerprint()) {
		window.localStorage.setItem(STORAGE_KEY_SELF, JSON.stringify(binding));
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

/**
 * Heading offset in degrees for a pane within its group's panorama arc.
 * solo / center = 0, left/right = ±(arc/2 - arc/6) — matches prod parallax.
 */
export function headingOffsetForRole(role: DeviceRole, panoramaArcDeg = 44): number {
	switch (role) {
		case 'left':  return -panoramaArcDeg / 2 + panoramaArcDeg / 6;
		case 'right': return  panoramaArcDeg / 2 - panoramaArcDeg / 6;
		default:      return 0;
	}
}
