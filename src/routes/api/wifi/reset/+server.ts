/**
 * POST /api/wifi/reset — purge saved WiFi profiles + reboot.
 *
 * On next boot the Pi has no WiFi → aero-wifi-portal.service detects this
 * and spawns the captive setup AP. The customer reconfigures from their phone.
 *
 * Auth model: bearer token via `Authorization: Bearer <AERO_WIFI_RESET_TOKEN>`.
 * The token is read from `process.env.AERO_WIFI_RESET_TOKEN`. If the env var
 * is unset, the endpoint fails closed with 503 — no accidental reboots if
 * the Pi is deployed without explicitly enabling this hatch. This matches
 * the codebase's "fail closed at the dangerous edge, LAN-trust everywhere
 * else" posture.
 */

import { json, error } from '@sveltejs/kit';
import { spawn } from 'node:child_process';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const expected = process.env.AERO_WIFI_RESET_TOKEN;
	if (!expected) {
		throw error(503, 'wifi reset endpoint disabled: AERO_WIFI_RESET_TOKEN not set');
	}

	const header = request.headers.get('authorization') ?? '';
	const match = header.match(/^Bearer\s+(.+)$/i);
	const presented = match?.[1]?.trim();

	if (!presented || !timingSafeEqual(presented, expected)) {
		throw error(401, 'invalid bearer token');
	}

	// Async fire-and-forget: schedule the reset for ~2s out so we have time to
	// return a 200 to the caller before the network drops + reboot kicks in.
	scheduleReset();
	return json({
		ok: true,
		message: 'WiFi will be cleared and the device will reboot in ~2 seconds. Reconnect via the setup portal.',
	});
};

/**
 * Constant-time string compare. Vanilla === leaks the token byte-by-byte
 * through response timing. Length mismatch short-circuits, but that only
 * leaks "wrong length" which is fine — the token is fixed-length per
 * deployment.
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

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
