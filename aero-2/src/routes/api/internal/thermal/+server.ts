/**
 * GET /api/internal/thermal — loopback-only thermal state for this kiosk.
 *
 * health-check.sh writes /run/aero/thermal.json every 60 s;
 * `settings/thermal-poll.ts` reads this from `Display.svelte` and drops
 * `qualityMode` to `performance` while the action is `shed`. Deliberately not
 * shared between panes: one hot edge pane must not dim the whole wall, which is
 * the whole reason this is loopback-only rather than part of the wall state.
 *
 * That consumer did not exist until 2026-09-04, and this comment claimed it did
 * — the endpoint, the decoder, the hysteresis policy and the writer were all
 * built and tested with nothing on the other end. Worth stating plainly: a
 * docstring in the present tense is a claim, and this one was false for as long
 * as it took someone to check.
 *
 * Loopback is the entire security boundary here, so it is checked strictly and
 * the answer for anything else is 403 with no detail.
 */

import { json } from '@sveltejs/kit';

import { isLoopback } from '#lib/server/loopback.js';
import { readThermalState } from '#lib/server/thermal.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ getClientAddress }) => {
	if (!isLoopback(getClientAddress())) {
		return json({ error: 'forbidden: localhost only' }, { status: 403 });
	}

	// 200 with `state: null` and a reason, not 204. "Thermal is fine" and
	// "nothing is reporting thermal" must not render identically.
	return json(readThermalState(process.env.AERO_THERMAL_STATE_PATH));
};
