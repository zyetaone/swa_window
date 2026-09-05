/**
 * Post-process shader contract.
 *
 * Cesium prepends a preamble to every PostProcessStage fragment shader (GLSL
 * version, precision, `out_FragColor`) but does NOT declare the varying
 * `v_textureCoordinates`. A stage that samples with it and forgets to declare
 * it compiles fine in TypeScript, ships, and then fails at GPU compile time —
 * at which point Cesium stops rendering the scene ENTIRELY:
 *
 *   "An error occurred while rendering. Rendering has stopped."
 *
 * That is a black window on a wall-mounted Pi caused by a missing one-line
 * declaration, and it is invisible to `check`, to the unit suite, and to a
 * screenshot of any daytime scene. `hash-palette.ts` shipped exactly that bug.
 *
 * Shaders are read FROM DISK rather than imported, so this also covers the ones
 * that are module-private (lightning) or inline in a component (the night lab).
 * Exporting them just to test them would widen those APIs for no other reason.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { BUILDING_BEACON } from '$lib/world/buildings';

/** Extract every `/* glsl *\/`-tagged or *_SHADER/*_GLSL template literal. */
function extractShaders(file: string): Record<string, string> {
	const src = readFileSync(file, 'utf8');
	const out: Record<string, string> = {};
	const re = /(?:const|let)\s+([A-Za-z0-9_]*(?:SHADER|GLSL))\s*(?::[^=]+)?=\s*(?:\/\*\s*glsl\s*\*\/\s*)?`([\s\S]*?)`/g;
	for (const m of src.matchAll(re)) out[`${file}:${m[1]}`] = m[2];
	return out;
}

const FILES = execSync(
	"git ls-files 'src/**/*.ts' 'src/**/*.svelte'", { encoding: 'utf8' },
)
	.split('\n')
	.filter(Boolean)
	.filter((f) => {
		const src = readFileSync(f, 'utf8');
		// Post-process stages and the model shaders (buildings) both matter.
		return src.includes('v_textureCoordinates') || src.includes('czm_modelMaterial');
	});

const SHADERS: Record<string, string> = Object.assign({}, ...FILES.map(extractShaders));

describe('post-process fragment shaders', () => {
	it('finds the shaders it means to check', () => {
		// Guard against the extractor silently matching nothing after a refactor,
		// which would make every test below vacuously pass.
		expect(Object.keys(SHADERS).length).toBeGreaterThanOrEqual(4);
	});

	for (const [name, src] of Object.entries(SHADERS)) {
		describe(name, () => {
			it('declares v_textureCoordinates if it uses it', () => {
				if (!src.includes('v_textureCoordinates')) return;
				expect(src).toMatch(/\bin\s+vec2\s+v_textureCoordinates\s*;/);
			});

			it('declares every uniform it references', () => {
				// Cesium CustomShader (the buildings model shader) declares its uniforms
				// in JS via the `uniforms:` map and injects them, so GLSL declarations
				// are correctly absent there. Only PostProcessStage shaders must
				// declare their own.
				if (src.includes('czm_modelMaterial')) return;
				const used = new Set([...src.matchAll(/\bu_[A-Za-z0-9_]+/g)].map((m) => m[0]));
				for (const u of used) {
					expect(src, `${u} used but not declared`).toMatch(
						new RegExp(`uniform\\s+\\w+\\s+${u}\\s*;`),
					);
				}
			});

			it('uses GLSL 3.00 sampling (texture, not texture2D)', () => {
				// Cesium's preamble is `#version 300 es`; texture2D was removed there.
				expect(src).not.toMatch(/\btexture2D\s*\(/);
			});

			it('has no backtick in a comment (would end the template literal)', () => {
				// Bitten twice: a JS-style `identifier` quote inside a GLSL comment
				// terminates the enclosing template literal, truncating the shader.
				// The brace check below catches the wreckage; this names the cause.
				expect(src).not.toContain('`');
			});

			it('has balanced braces', () => {
				expect((src.match(/{/g) ?? []).length).toBe((src.match(/}/g) ?? []).length);
			});

			it('does not multiply a colour by a raw >1 operator knob', () => {
				// Emissive/colour output is LDR: anything past 1.0 per channel clips to
				// pure white and destroys the palette. u_lightIntensity carries a 0..5
				// operator knob, so each use must either be normalised (divided by the
				// scale max) or explicitly clamped at the point of use. The buildings
				// shader did neither and every window clipped, even the dimmest.
				if (!src.includes('u_lightIntensity')) return;
				// Three legitimate ways to keep an LDR output in range:
				//   normalise the knob, clamp at the point of use, or TONE-MAP the
				//   accumulated HDR value downstream. Tone-mapping is preferred for
				//   emissive because dividing the gain down costs real brightness —
				//   it fixes clipping by making the city dim, which is its own bug.
				const toneMapped = /\/\s*\(1\.0\s*\+|1\.0\s*\+\s*\w+\s*\/\s*\(W\s*\*\s*W\)/.test(src);
				if (toneMapped) return;
				for (const line of src.split('\n')) {
					if (!/\*\s*u_lightIntensity|u_lightIntensity\s*\*/.test(line)) continue;
					const normalised = /u_lightIntensity\s*\//.test(line);
					const clampedHere = /\b(min|clamp|saturate)\s*\(/.test(line);
					expect(
						normalised || clampedHere,
						`unbounded colour scale by u_lightIntensity: ${line.trim()}`,
					).toBe(true);
				}
			});
		});
	}
});

describe('building beacon contract (whole-skyline red pulse regression)', () => {
	// Two failures once made every rooftop beacon in the city pulse red IN
	// LOCKSTEP: the height gate was low enough to light mid-rise blocks, and
	// the blink oscillator had no per-building phase. The shader body
	// interpolates BUILDING_BEACON, so the extracted GLSL below contains the
	// ${...} expressions verbatim — assert on structure there, on values here.
	const beacon = SHADERS['src/lib/world/buildings.ts:BUILDING_SHADER_GLSL'];

	it('finds the buildings shader', () => {
		expect(beacon).toBeDefined();
	});

	it('blink is phase-offset per block — lockstep can never come back', () => {
		// The regression form was `step(0.4, fract(u_time * 0.5))` — a pure
		// function of time, identical for every building on earth.
		expect(beacon).toMatch(/beaconPhase\s*=\s*fract\(\s*sin\(\s*dot\(/);
		expect(beacon).toMatch(/fract\(\s*u_time[\s\S]{0,80}?\+\s*beaconPhase\s*\)/);
	});

	it('gates beacons to tall rooftops only', () => {
		expect(beacon).toMatch(/isTall\s*=\s*smoothstep\(/);
		expect(beacon).toMatch(/isRoof\s*\*\s*isTall\s*\*\s*blink/);
	});

	it('keeps the shipped height gate — mid-rise blocks must not light', () => {
		// Was 30 m: at that gate half the skyline blinked. Assert at the SSOT
		// so a revert fails here even though the GLSL interpolates the values.
		expect(BUILDING_BEACON.heightMinM).toBeGreaterThanOrEqual(100);
		expect(BUILDING_BEACON.heightMaxM).toBeGreaterThan(BUILDING_BEACON.heightMinM);
		expect(BUILDING_BEACON.phaseBlockM).toBeGreaterThan(0);
		expect(BUILDING_BEACON.blinkHz).toBeGreaterThan(0);
	});
});
