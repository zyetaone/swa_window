/**
 * Can the device get back online after /api/wifi/reset purges its WiFi?
 *
 * Lives here rather than in the route: SvelteKit restricts `+server.ts` to a
 * fixed export list (GET/POST/…/config, or `_`-prefixed names), so exporting
 * this helper from the route failed the BUILD — while `svelte-check` and the
 * test suite both passed, because neither runs the route-export validation.
 */

import { existsSync } from 'node:fs';

/** systemd unit that raises the captive setup AP when no WiFi is configured. */
const PORTAL_UNIT = '/etc/systemd/system/aero-wifi-portal.service';
/** Binary the unit execs. deploy/aero-wifi-portal.sh hardcodes this path. */
const PORTAL_BIN = '/usr/local/bin/wifi-connect';

/**
 * Is there anything to come back to after we purge WiFi and reboot?
 *
 * ─── ⚠ WITHOUT THIS THE ENDPOINT IS A REMOTE BRICK BUTTON ───────────────────
 * The purge is only survivable because /api/wifi/reset's header promises the
 * portal comes up on next boot. It does not: install.sh's unit loop installs
 * aero-xserver / aero-app / aero-kiosk / aero-updater ONLY, and
 * aero-wifi-portal.service lives in deploy/ rather than deploy/pi/ where
 * SCRIPT_DIR points — so it has never been copied to a provisioned Pi. The
 * wifi-connect binary it execs is never downloaded either (not in the apt
 * list, no fetch anywhere).
 *
 * On a fielded device the sequence was therefore: purge WiFi → reboot → no
 * portal → permanently offline. No LAN, no OTA, no heartbeat, no recovery
 * short of physical access with a keyboard or the SD card. On a client-site
 * kiosk that means someone travels.
 *
 * So: verify the recovery path EXISTS before destroying the working one.
 * Refusing to run is always better than a reboot into nothing.
 *
 * Non-Linux short-circuits to available — schedulePrivileged is already a
 * warn-and-no-op off Linux, so no purge can happen on a dev host and there is
 * nothing to guard.
 *
 * Deliberately checks presence, not `systemctl is-enabled`: that needs a
 * spawn, and an installed-but-disabled unit is a far narrower failure than
 * the "never installed at all" case this exists to catch.
 */
export function wifiRecoveryAvailable(): { ok: boolean; reason?: string } {
	if (process.platform !== 'linux') return { ok: true };
	if (!existsSync(PORTAL_UNIT)) {
		return { ok: false, reason: `${PORTAL_UNIT} is not installed` };
	}
	if (!existsSync(PORTAL_BIN)) {
		return { ok: false, reason: `${PORTAL_BIN} is missing` };
	}
	return { ok: true };
}
