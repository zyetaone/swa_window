/**
 * POST /api/wifi/reset — purge saved WiFi profiles + reboot.
 *
 * On next boot the Pi has no WiFi → aero-wifi-portal.service detects this
 * and spawns the captive setup AP. The customer reconfigures from their phone.
 *
 * Auth model: LAN-only (the Pi is not exposed to public internet by default).
 * Before commercial release, gate behind a shared secret in `Authorization`.
 */

import { json } from '@sveltejs/kit';
import { spawn } from 'node:child_process';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	// Async fire-and-forget: schedule the reset for ~2s out so we have time to
	// return a 200 to the caller before the network drops + reboot kicks in.
	scheduleReset();
	return json({
		ok: true,
		message: 'WiFi will be cleared and the device will reboot in ~2 seconds. Reconnect via the setup portal.',
	});
};

/** Internal — only invokable on the Pi (uses sudo + nmcli + reboot). */
function scheduleReset(): void {
	if (process.platform !== 'linux') {
		console.warn('[wifi/reset] non-linux platform — no-op');
		return;
	}
	setTimeout(() => {
		// Delete every saved 802-11-wireless connection.
		const purge = spawn(
			'sh',
			['-c', `for c in $(nmcli -t -f NAME,TYPE c | awk -F: '$2=="802-11-wireless"{print $1}'); do sudo nmcli c delete "$c" || true; done && sudo /sbin/reboot`],
			{ detached: true, stdio: 'ignore' },
		);
		purge.unref();
	}, 2000);
}
