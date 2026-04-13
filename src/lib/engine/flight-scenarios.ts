/**
 * Flight Scenario Picker — selects scenarios and next locations.
 *
 * Scenario data lives in scenario-data.ts.
 * This module indexes it and provides weighted random selection
 * based on sky state (time of day).
 */

import type { LocationId, SkyState } from '$lib/shared/types';
import { LOCATION_IDS } from '$lib/shared/locations';
import { getSkyState } from '$lib/shared/utils';
import { SCENARIOS, type FlightScenario } from './scenario-data';

export type { FlightScenario, Waypoint } from './scenario-data';

// ============================================================================
// LOOKUP
// ============================================================================

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
export function pickScenario(locationId: LocationId, skyState: SkyState): FlightScenario | null {
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
	let roll = Math.random() * totalWeight;
	for (const c of candidates) {
		roll -= Math.max(c.score, 0.5);
		if (roll <= 0) return c.scenario;
	}

	return candidates[candidates.length - 1].scenario;
}

/**
 * Pick a random next location, excluding the current one.
 * Weighted by scenario availability for the current sky state.
 */
export function pickNextLocation(currentId: LocationId, timeOfDay: number): LocationId {
	const skyState = getSkyState(timeOfDay);
	const allLocations = [...LOCATION_IDS].filter(id => id !== currentId);
	if (allLocations.length === 0) return currentId;

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
