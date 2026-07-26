/**
 * Flight scenario picker — pure logic over the authored scenario catalog.
 *
 * The waypoint data lives at `$content/scenarios` (Rule 0: content/control
 * split). This module only contains the picker functions the director ticks
 * call: `pickScenario` (for a specific location) and `pickNextLocation`
 * (weighted random across locations, biased by sky-state availability).
 */

import type { LocationId, SkyState, FlightScenario } from '$lib/types';
import { SCENARIOS } from '$content/scenarios';
import { LOCATION_IDS, LOCATION_MAP } from '$content/locations';
import { getSkyState } from '$lib/utils';

const SCENARIOS_BY_LOCATION = new Map<LocationId, FlightScenario[]>();
for (const s of SCENARIOS) {
	const existing = SCENARIOS_BY_LOCATION.get(s.locationId) ?? [];
	existing.push(s);
	SCENARIOS_BY_LOCATION.set(s.locationId, existing);
}

/**
 * Pick a scenario for the given location, preferring one that matches the current sky state.
 * Falls back to 'any' scenarios, then any scenario for that location.
 */
export function pickScenario(locationId: LocationId, skyState: SkyState, rng: () => number = Math.random): FlightScenario | null {
	const pool = SCENARIOS_BY_LOCATION.get(locationId);
	if (!pool || pool.length === 0) return null;

	const scored = pool.map(s => ({
		scenario: s,
		score: s.preferredTime === skyState ? 3
			: s.preferredTime === 'any' ? 1
			: 0,
	}));

	const viable = scored.filter(s => s.score > 0);
	const candidates = viable.length > 0 ? viable : scored;

	const totalWeight = candidates.reduce((sum, c) => sum + Math.max(c.score, 0.5), 0);
	let roll = rng() * totalWeight;
	for (const c of candidates) {
		roll -= Math.max(c.score, 0.5);
		if (roll <= 0) return c.scenario;
	}

	return candidates[candidates.length - 1].scenario;
}

export interface PickNextLocationOptions {
	/**
	 * Restrict the candidate pool to locations whose `hasBuildings === true`
	 * (i.e. cities with OSM building extrusions and real VIIRS night-light
	 * footprint). Used by the director autopilot to keep the camera over a
	 * lit footprint at night-themed kiosk installs. Defaults to false.
	 *
	 * If filtering would leave zero candidates (e.g. only one city in the
	 * catalog and the camera is already there), falls back to the full pool
	 * so the picker still progresses rather than stalling.
	 */
	nightLitOnly?: boolean;
}

/**
 * Pick a random next location, excluding the current one.
 * Weighted by scenario availability for the current sky state.
 */
export function pickNextLocation(
	currentId: LocationId,
	timeOfDay: number,
	options: PickNextLocationOptions = {},
): LocationId {
	const skyState = getSkyState(timeOfDay);
	let allLocations = [...LOCATION_IDS].filter(id => id !== currentId);
	if (allLocations.length === 0) return currentId;

	if (options.nightLitOnly) {
		const lit = allLocations.filter(id => LOCATION_MAP.get(id)?.hasBuildings === true);
		// Only narrow if the filter still has candidates; otherwise let the
		// full pool through so the director keeps moving.
		if (lit.length > 0) allLocations = lit;
	}

	const allScenarios = SCENARIOS.filter(s => s.locationId !== currentId);

	const scored = allLocations.map((id: LocationId) => {
		const locScenarios = allScenarios.filter(s => s.locationId === id);
		let score = 0;
		for (const s of locScenarios) {
			if (s.preferredTime === skyState) score += 3;
			else if (s.preferredTime === 'any') score += 1;
		}
		return { id, score: Math.max(score, 0.5) };
	});

	const total = scored.reduce((sum: number, s: { score: number }) => sum + s.score, 0);
	let roll = Math.random() * total;
	for (const s of scored) {
		roll -= s.score;
		if (roll <= 0) return s.id;
	}
	return scored[scored.length - 1].id;
}
