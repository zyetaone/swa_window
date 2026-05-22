/**
 * Post-process color grading shader — Phase 9 (Apr-15 hash palette
 * productionized from night-lab Variant G).
 *
 * Pixel-level finishing pass after Cesium has composited imagery + bloom.
 * Six jobs in render order:
 *
 *   1. lightMask    — widened `smoothstep(0.08, 0.65, lum)` (was brightGuard
 *                     0.75-0.95). Catches VIIRS-lit pixels + spill so the
 *                     navy mix below doesn't crush amber city lights.
 *   2. chroma gate  — clamp lightMask by red-bias `rgb.r - rgb.b` so the
 *                     hash palette only paints warm pixels (VIIRS amber) and
 *                     not cool atmospheric haze / water glint / snow.
 *   3. hash palette — 3-stop warm (sodium → amber → warm-white) blended by
 *                     `lum + (hash - 0.5) × paletteSpread`. Per-pixel UV hash
 *                     gives organic colour variance — cities read painterly
 *                     instead of uniformly amber. 3% of lit pixels go traffic
 *                     red for beacon/taillight character.
 *   4. baseDarken   — Phase 15.5 navy mix, but gated by `(1 - lightMask)`
 *                     instead of `(1 - brightGuard)`. Lit pixels survive the
 *                     darkening; only unlit terrain pushes toward navy.
 *   5. dark void    — push lum < 0.2 toward true black at deep night so
 *                     cities pop as islands of light.
 *   6. pollution    — Phase 15.5 warm corona on already-bright pixels.
 *   7. ambient      — neutral-warm moonlight floor so terrain isn't pure void.
 *
 * Authored design: night should read calm-amber, geographically accurate
 * (VIIRS provides the footprint), painterly (palette variance), and lifted
 * (moonlight floor + ACES tonemap in compose.ts). All at zero cost when
 * `nightFactor = 0`.
 *
 * History: this shader resurrects commit e4a9525 (Apr 15, 2026) "emissive
 * city lights — per-pixel palette variance + bloom" with three changes:
 *   • palette reduced 5→3 stops (cool/blue stops removed for SWA calm-amber
 *     brand — they bled violet on the Phase 15.5 navy backdrop)
 *   • new chroma-bias VIIRS gate prevents palette from landing on cool
 *     atmosphere pixels (would also bleed violet)
 *   • lightMask now guards the navy darken (Phase 15.5's brightGuard 0.75
 *     was too tight, crushed most VIIRS amber)
 */

export const COLOR_GRADING_GLSL = `
	uniform sampler2D colorTexture;
	uniform float u_nightFactor;
	uniform float u_lightIntensity;
	uniform float u_paletteSpread;
	uniform float u_additiveStrength;
	uniform float u_redSparkRate;
	uniform float u_darkVoidStrength;
	uniform float u_envLight;
	uniform float u_viirsMaskStrength;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		vec3 rgb = color.rgb;
		float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

		float brightGuard = smoothstep(0.75, 0.95, lum);

		// Phase 16: Sharpened lightMask and red-bias gate. City lights (even
		// grayscale ones) now reach 1.0 mask much earlier (lum=0.25).
		// red-bias gate now treats anything >= -0.02 as 1.0 likely, which
		// catches grayscale (0.0) fully while excluding navy (-0.06).
		float lightMask = smoothstep(0.02, 0.25, lum);

		float redBias = rgb.r - rgb.b;
		float viirsLikely = smoothstep(-0.12, -0.02, redBias);
		lightMask *= mix(1.0, viirsLikely, u_viirsMaskStrength);

		// Desat under lights — kills blue-base / amber-light → purple bleed.
		vec3 grayBase = vec3(lum);
		rgb = mix(rgb, grayBase, lightMask * 0.8 * u_nightFactor);

		// Per-pixel UV hash for palette variance.
		float hash = fract(sin(dot(v_textureCoordinates * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
		float paletteLum = clamp(lum + (hash - 0.5) * u_paletteSpread, 0.0, 1.0);

		// 3-stop warm palette (sodium → amber → warm-white). Calm-amber brand.
		vec3 sodium   = vec3(1.0, 0.6, 0.2);
		vec3 amber    = vec3(1.0, 0.8, 0.4);
		vec3 warmWht  = vec3(1.0, 0.95, 0.85);
		vec3 trafficRed = vec3(1.0, 0.15, 0.05);

		vec3 lightColor = mix(sodium, amber, smoothstep(0.15, 0.5, paletteLum));
		lightColor = mix(lightColor, warmWht, smoothstep(0.5, 0.9, paletteLum));

		// 3% red sparks for beacon/taillight texture.
		float redSpark = step(1.0 - u_redSparkRate, fract(hash * 7.3));
		lightColor = mix(lightColor, trafficRed, redSpark * lightMask * 0.8);

		// Phase 16: increased VIIRS-contrast-driven density amplification.
		// Makes city cores punch even harder.
		float viirsContrastBoost = 1.0 + pow(viirsLikely, 0.6) * 0.8;

		// Additive emissive — VIIRS-contrast-weighted. Clamped at 4.0 for HDR
		// headroom (ACES tonemap in compose.ts maps the wider range).
		rgb += lightColor * lum * u_additiveStrength * u_nightFactor * viirsContrastBoost;
		rgb = min(rgb, vec3(4.0));

		// Phase 15.5 base darkening — guarded by lightMask (not brightGuard)
		// so VIIRS amber survives the navy mix. The Phase 9 win.
		float darkenAmount = smoothstep(0.45, 0.9, u_nightFactor) * 0.85;
		rgb = mix(rgb, vec3(0.02, 0.04, 0.08), darkenAmount * (1.0 - lightMask) * (1.0 - brightGuard));

		// Dark void crush — push lum < 0.2 toward black so cities pop.
		// Phase 16: softened crush (0.85 max) so terrain detail survives.
		float darkVoid = 1.0 - smoothstep(0.05, 0.2, lum);
		rgb = mix(rgb, vec3(0.0), darkVoid * u_nightFactor * (u_darkVoidStrength * 0.85) * (1.0 - brightGuard));

		// Phase 15.5 pollution corona — broadened footprint for visible amber dome.
		float pollution = smoothstep(0.10, 0.5, lum) * u_nightFactor;
		rgb = min(rgb + vec3(0.18, 0.09, 0.02) * pollution * u_lightIntensity, vec3(1.0));

		// Phase 10 — Aerial perspective radial falloff. At cruise altitude
		// (-75° pitch), distant terrain reads in the UPPER portion of frame.
		// Lerp those pixels toward atmospheric haze color to create depth.
		// At day: cool blue-grey haze. At night: warm pollution-dome amber.
		// 4 lines of GLSL, biggest perceptual realism gain per line of shader.
		float aerialDistance = clamp((0.55 - v_textureCoordinates.y) * 1.8, 0.0, 1.0);
		aerialDistance = pow(aerialDistance, 1.4);
		vec3 dayHaze = vec3(0.55, 0.62, 0.72);
		vec3 nightHaze = vec3(0.22, 0.16, 0.10);  // warm pollution dome
		vec3 hazeColor = mix(dayHaze, nightHaze, u_nightFactor);
		rgb = mix(rgb, hazeColor, aerialDistance * 0.35);

		// Neutral-warm ambient moonlight floor — applied LAST so dark-void
		// can't push terrain to pure void. Aligns with calm-amber brand
		// (cool floor would stack to violet against navy backdrop).
		// Phase 16: 0.035 → 0.045; Phase 17 (user "can't see the map"):
		// 0.045 → 0.085 so terrain detail survives the aggressive
		// skyDarken + dark-void combo at deep night.
		vec3 ambient = vec3(0.085, 0.08, 0.072) * u_envLight * u_nightFactor;
		rgb = max(rgb, ambient);

		out_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
	}
`;
