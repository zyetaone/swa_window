/**
 * GET /api/internal/thermal — loopback-only thermal state for the local kiosk.
 *
 * health-check.sh writes `/run/aero/thermal.json` every 60s (temp + vcgencmd
 * get_throttled + load-shed action). The browser polls this endpoint and
 * locally sheds GPU work (quality performance, Three overlay off) when
 * `action === 'shed'`. Not peer-synced — one hot edge pane must not dim the
 * whole corridor.
 *
 * 403 for non-loopback. 204 when the file is missing (non-Pi / pre-install).
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, existsSync } from 'node:fs';
import { isLoopback } from '$lib/http/loopback';
import {
	decodeThrottleFlags,
	parseThrottledRaw,
	thermalAction,
	type ThermalAction,
	type ThermalStateFile,
} from '$lib/fleet/throttle';

const STATE_PATH = process.env.AERO_THERMAL_STATE_PATH ?? '/run/aero/thermal.json';

export const GET: RequestHandler = async ({ getClientAddress }) => {
	if (!isLoopback(getClientAddress())) throw error(403, 'forbidden: localhost only');

	if (!existsSync(STATE_PATH)) {
		return new Response(null, { status: 204 });
	}

	try {
		const raw = readFileSync(STATE_PATH, 'utf8');
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const tempC = typeof parsed.tempC === 'number' && Number.isFinite(parsed.tempC)
			? parsed.tempC
			: 0;
		const throttledRaw = parseThrottledRaw(parsed.throttledRaw);
		const flags = decodeThrottleFlags(throttledRaw);
		const prev: ThermalAction = parsed.action === 'shed' ? 'shed' : 'ok';
		// Re-derive action server-side so a stale file action can't disagree
		// with the pure policy (or a hand-edited JSON can't force shed forever
		// after temp has dropped).
		const action = thermalAction(tempC, flags, prev);
		const updatedAtMs =
			typeof parsed.updatedAtMs === 'number' && Number.isFinite(parsed.updatedAtMs)
				? parsed.updatedAtMs
				: 0;

		const body: ThermalStateFile = {
			tempC,
			throttledRaw,
			action,
			updatedAtMs,
			flags,
		};
		return json(body);
	} catch {
		throw error(502, 'thermal state unreadable');
	}
};
