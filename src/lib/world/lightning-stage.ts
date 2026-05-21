/**
 * Lightning post-process stage — Cesium-native scene-wide flash.
 *
 * Reframe context (2026-05-22): replaces the prior DOM Lightning.svelte,
 * which painted a CSS radial gradient over the Cesium canvas. That
 * approach lit only the rendered frame (no occlusion, no parallax) and
 * read as "tint on the glass" rather than "the world is being lit."
 *
 * The new stage runs in Cesium's post-process pipeline AFTER the scene
 * has rendered. A single uniform `u_flash` rises from 0 to ~0.9 at
 * strike onset, then decays. The shader adds a soft warm-white wash
 * weighted by an off-center radial centered at (u_strike_x, u_strike_y)
 * so the brightest part of the flash sits roughly where the strike
 * appears in screen space — same intuition as the DOM ellipse before,
 * but now the wash is part of the scene image and IS the lit world.
 *
 * Composition picker (sheet / forked / distant) drives the timing,
 * intensity, and x/y placement — same recipes as before.
 */

import type * as CesiumType from 'cesium';
import { randomBetween, clamp } from '$lib/utils';
import {
	pickLightningComposition,
	type LightningComposition,
} from '$content/compositions/lightning';

const LIGHTNING_GLSL = /* glsl */ `
	uniform sampler2D colorTexture;
	uniform float u_flash;
	uniform float u_strike_x;
	uniform float u_strike_y;
	in vec2 v_textureCoordinates;

	void main() {
		vec4 color = texture(colorTexture, v_textureCoordinates);
		if (u_flash < 0.001) {
			out_FragColor = color;
			return;
		}

		// Distance from this fragment to the strike center, in normalised
		// screen space. A wide ellipse so the flash reads as ambient
		// world-lighting rather than a hard halo.
		vec2 d = v_textureCoordinates - vec2(u_strike_x, u_strike_y);
		d.x *= 1.2;        // slight horizontal stretch
		float dist = length(d);
		float radial = 1.0 - smoothstep(0.0, 1.0, dist);

		// Cool blue-white wash — matches the previous DOM gradient's
		// (200, 200, 255) → (150, 150, 230) palette.
		vec3 flashColor = mix(
			vec3(0.59, 0.59, 0.90),
			vec3(0.78, 0.78, 1.0),
			radial,
		);

		// Additive blend, saturated by u_flash. Centre fragments get full
		// contribution; edges still receive ~30% of the flash for the
		// "the sky just lit up" feel.
		float gain = u_flash * (0.3 + 0.7 * radial);
		out_FragColor = vec4(color.rgb + flashColor * gain, color.a);
	}
`;

export class LightningStage {
	private flash = 0;        // 0..1 current flash intensity
	private x = 0.5;          // strike screen-x (0..1)
	private y = 0.4;          // strike screen-y
	private timer = 0;
	private nextStrike = 10;
	private composition: LightningComposition | null = null;
	private prevHasLightning = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private stage: any = null;

	constructor(
		private C: typeof CesiumType,
		private viewer: CesiumType.Viewer,
	) {}

	mount(): void {
		if (this.stage) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const C = this.C as any;
		this.stage = new C.PostProcessStage({
			name: 'aero-lightning',
			fragmentShader: LIGHTNING_GLSL,
			uniforms: {
				u_flash: () => this.flash,
				u_strike_x: () => this.x,
				u_strike_y: () => this.y,
			},
		});
		this.stage.enabled = false;     // toggled on when first strike fires
		this.viewer.scene.postProcessStages.add(this.stage);
	}

	/**
	 * Per-frame tick — drives the strike timer and the flash decay envelope.
	 *
	 * @param delta            seconds since last call
	 * @param hasLightning     model.config.atmosphere.weather.hasLightning
	 * @param defaultDecayRate model.config.atmosphere.weather.lightningDecayRate
	 * @param defaultMin       lightningMinInterval fallback
	 * @param defaultMax       lightningMaxInterval fallback
	 */
	tick(
		delta: number,
		hasLightning: boolean,
		defaultDecayRate: number,
		defaultMin: number,
		defaultMax: number,
	): void {
		if (!this.stage) return;

		// Roll a new composition when storm starts; clear when it ends.
		if (hasLightning && !this.prevHasLightning) {
			this.composition = pickLightningComposition();
		} else if (!hasLightning && this.prevHasLightning) {
			this.composition = null;
		}
		this.prevHasLightning = hasLightning;

		if (!hasLightning) {
			this.flash = 0;
			this.stage.enabled = false;
			return;
		}

		this.stage.enabled = true;

		const c = this.composition;
		const decayRate = c?.decayRate ?? defaultDecayRate;

		this.timer += delta;
		if (this.flash > 0) {
			this.flash = clamp(this.flash - delta * decayRate, 0, 1);
		}
		if (this.flash < 0.01 && this.timer > this.nextStrike) {
			if (c) {
				this.flash = randomBetween(c.intensityRange[0], c.intensityRange[1]);
				// Recipes are in percent (0..100); shader wants 0..1.
				this.x = randomBetween(c.xRange[0], c.xRange[1]) / 100;
				this.y = randomBetween(c.yRange[0], c.yRange[1]) / 100;
				this.nextStrike = randomBetween(c.intervalRange[0], c.intervalRange[1]);
			} else {
				this.flash = randomBetween(0.5, 1);
				this.x = randomBetween(20, 80) / 100;
				this.y = randomBetween(15, 65) / 100;
				this.nextStrike = randomBetween(defaultMin, defaultMax);
			}
			this.timer = 0;
		}
	}

	destroy(): void {
		if (this.stage) {
			this.viewer.scene.postProcessStages.remove(this.stage);
			this.stage = null;
		}
	}
}
