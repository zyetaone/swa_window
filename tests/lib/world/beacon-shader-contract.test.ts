/**
 * Building aviation-beacon contract.
 *
 * The whole skyline used to pulse red in lockstep: height threshold was
 * 30–50 m (every mid-rise) and blink phase was global. Contract:
 *   - height smoothstep floors at BUILDING_BEACON.heightMinM (≥120)
 *   - per-block phase hash uses phaseBlockM
 *   - blink uses blinkThreshold / blinkHz from the same SSOT
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILDING_BEACON } from '$lib/world/buildings';

const SRC = readFileSync('src/lib/world/buildings.ts', 'utf8');
const SHADER = (() => {
	const m = SRC.match(/const BUILDING_SHADER_GLSL\s*=\s*`([\s\S]*?)`;/);
	if (!m) throw new Error('BUILDING_SHADER_GLSL not found');
	return m[1];
})();

describe('BUILDING_BEACON SSOT', () => {
	it('keeps the tall-tower floor at 120 m+', () => {
		expect(BUILDING_BEACON.heightMinM).toBeGreaterThanOrEqual(120);
		expect(BUILDING_BEACON.heightMaxM).toBeGreaterThan(BUILDING_BEACON.heightMinM);
	});

	it('embeds BUILDING_BEACON into the GLSL template (interpolated at runtime)', () => {
		// Source keeps ${BUILDING_BEACON.*} — evaluated when the module loads.
		// Assert the template wires the SSOT, not a re-inlined magic number.
		expect(SHADER).toMatch(/BUILDING_BEACON\.heightMinM/);
		expect(SHADER).toMatch(/BUILDING_BEACON\.heightMaxM/);
		expect(SHADER).toMatch(/BUILDING_BEACON\.phaseBlockM/);
		expect(SHADER).toMatch(/BUILDING_BEACON\.blinkThreshold/);
		expect(SHADER).toMatch(/BUILDING_BEACON\.blinkHz/);
		// And the runtime constants still match the intended contract.
		expect(BUILDING_BEACON.heightMinM.toFixed(1)).toBe('120.0');
		expect(BUILDING_BEACON.heightMaxM.toFixed(1)).toBe('160.0');
	});

	it('uses a phase hash (not a global fract(u_time) alone)', () => {
		expect(SHADER).toMatch(/beaconPhase/);
		expect(SHADER).toMatch(/floor\(wp\.xy/);
		// Must not re-introduce bare fract(u_time * rate) without phase.
		expect(SHADER).not.toMatch(/fract\(\s*u_time\s*\*\s*0\.5\s*\)/);
	});
});
