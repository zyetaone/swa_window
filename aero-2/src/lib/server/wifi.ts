/**
 * Is there anything to come back to after /api/wifi/reset purges WiFi?
 *
 * ─── WITHOUT THIS CHECK THE ENDPOINT IS A REMOTE BRICK BUTTON ───────────────
 * The purge is only survivable because a captive setup portal comes up on the
 * next boot. On v1 it did not: install.sh's unit loop installed
 * aero-xserver / aero-app / aero-kiosk / aero-updater only, and
 * aero-wifi-portal.service sat in a directory the installer never read — so it
 * had never been copied to a provisioned Pi, and the wifi-connect binary it
 * execs was never downloaded at all.
 *
 * The sequence on a fielded device was therefore: purge → reboot → no portal →
 * permanently offline. No LAN, no OTA, no heartbeat, and no recovery short of
 * physical access with a keyboard or the SD card. At a client site that means
 * someone travels.
 *
 * So verify the recovery path exists before destroying the working one.
 * Refusing to run is always better than rebooting into nothing.
 *
 * Presence, not `systemctl is-enabled`: that needs a spawn, and
 * installed-but-disabled is a far narrower failure than the never-installed
 * case this exists to catch.
 */

import { existsSync } from 'node:fs';

/** The unit that raises the captive setup AP when no WiFi is configured. */
export const PORTAL_UNIT = '/etc/systemd/system/aero-wifi-portal.service';
/** The binary that unit execs. */
export const PORTAL_BIN = '/usr/local/bin/wifi-connect';

/**
 * Off Linux this is vacuously available: `schedulePrivileged` is already a
 * warn-and-no-op there, so no purge can happen and there is nothing to guard.
 */
export function wifiRecoveryAvailable(
	platform: string = process.platform,
	exists: (p: string) => boolean = existsSync
): { ok: boolean; reason?: string } {
	if (platform !== 'linux') return { ok: true };
	if (!exists(PORTAL_UNIT)) return { ok: false, reason: `${PORTAL_UNIT} is not installed` };
	if (!exists(PORTAL_BIN)) return { ok: false, reason: `${PORTAL_BIN} is missing` };
	return { ok: true };
}
