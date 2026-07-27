/**
 * LightningManager — Cesium post-process stage for ambient scene-wide flash.
 *
 * Composition picker (sheet / forked / distant) drives timing, intensity,
 * and screen-space placement.
 *
 * Replaces the prior DOM Lightning.svelte, which painted a CSS radial
 * gradient over the canvas (no occlusion, no parallax, read as "tint on
 * glass" rather than "the world is being lit"). The Cesium post-process
 * pipeline runs AFTER scene render, so the wash becomes part of the
 * scene image and IS the lit world.
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

		vec2 d = v_textureCoordinates - vec2(u_strike_x, u_strike_y);
		d.x *= 1.2;
		float dist = length(d);
		float radial = 1.0 - smoothstep(0.0, 1.0, dist);

		vec3 flashColor = mix(
			vec3(0.59, 0.59, 0.90),
			vec3(0.78, 0.78, 1.0),
			radial,
		);

		float gain = u_flash * (0.3 + 0.7 * radial);
		out_FragColor = vec4(color.rgb + flashColor * gain, color.a);
	}
`;

type C = typeof CesiumType;

export interface WeatherSlice {
	hasLightning: boolean;
	lightningDecayRate: number;
	lightningMinInterval: number;
	lightningMaxInterval: number;
}

export class LightningManager {
	readonly #C: C;
	readonly #viewer: CesiumType.Viewer;

	#flash = 0;
	#x = 0.5;
	#y = 0.4;
	#timer = 0;
	#nextStrike = 10;
	#composition: LightningComposition | null = null;
	#prevHasLightning = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#stage: any = null;

	constructor(Cesium: C, viewer: CesiumType.Viewer) {
		this.#C = Cesium;
		this.#viewer = viewer;
	}

	setup(): void {
		if (this.#stage) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const C = this.#C as any;
		this.#stage = new C.PostProcessStage({
			name: 'aero-lightning',
			fragmentShader: LIGHTNING_GLSL,
			uniforms: {
				u_flash: () => this.#flash,
				u_strike_x: () => this.#x,
				u_strike_y: () => this.#y,
			},
		});
		this.#stage.enabled = false;
		this.#viewer.scene.postProcessStages.add(this.#stage);
	}

	sync(dt: number, weather: WeatherSlice): void {
		if (!this.#stage) return;

		if (weather.hasLightning && !this.#prevHasLightning) {
			this.#composition = pickLightningComposition();
		} else if (!weather.hasLightning && this.#prevHasLightning) {
			this.#composition = null;
		}
		this.#prevHasLightning = weather.hasLightning;

		if (!weather.hasLightning) {
			this.#flash = 0;
			this.#stage.enabled = false;
			return;
		}

		this.#stage.enabled = true;

		const c = this.#composition;
		const decayRate = c?.decayRate ?? weather.lightningDecayRate;

		this.#timer += dt;
		if (this.#flash > 0) {
			this.#flash = clamp(this.#flash - dt * decayRate, 0, 1);
		}
		if (this.#flash < 0.01 && this.#timer > this.#nextStrike) {
			if (c) {
				this.#flash = randomBetween(c.intensityRange[0], c.intensityRange[1]);
				this.#x = randomBetween(c.xRange[0], c.xRange[1]) / 100;
				this.#y = randomBetween(c.yRange[0], c.yRange[1]) / 100;
				this.#nextStrike = randomBetween(c.intervalRange[0], c.intervalRange[1]);
			} else {
				this.#flash = randomBetween(0.5, 1);
				this.#x = randomBetween(20, 80) / 100;
				this.#y = randomBetween(15, 65) / 100;
				this.#nextStrike = randomBetween(
					weather.lightningMinInterval,
					weather.lightningMaxInterval,
				);
			}
			this.#timer = 0;
		}
	}

	destroy(): void {
		if (this.#stage) {
			this.#viewer.scene.postProcessStages.remove(this.#stage);
			this.#stage = null;
		}
	}
}
