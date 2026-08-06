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
