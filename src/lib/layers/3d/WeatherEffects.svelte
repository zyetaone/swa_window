<script lang="ts">
	/**
	 * WeatherEffects - Rain and lightning
	 *
	 * All animation state comes from model - no local timers
	 */
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { useAppState } from '$lib/core';

	const { model } = useAppState();

	// Rain shader - improved visibility and wind effects
	const rainMaterial = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uIntensity: { value: 0 },
			uWind: { value: 0 } // Wind angle offset
		},
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform float uTime;
			uniform float uIntensity;
			uniform float uWind;
			varying vec2 vUv;

			float hash(vec2 p) {
				return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
			}

			void main() {
				// Wind-angled rain (offset X by wind factor)
				vec2 uv = vUv;
				uv.x += uv.y * uWind * 0.3; // Rain streaks at angle

				// Multiple layers for depth
				float streak = 0.0;

				// Far layer (thin, fast, faint)
				float farX = floor(uv.x * 60.0);
				float farRand = hash(vec2(farX, 1.0));
				float farY = fract(uv.y - uTime * (0.8 + farRand * 0.3));
				float farStreak = smoothstep(0.0, 0.2, farY) * smoothstep(1.0, 0.8, farY);
				farStreak *= smoothstep(0.015, 0.0, abs(fract(uv.x * 60.0) - 0.5));
				farStreak *= step(0.65 - uIntensity * 0.25, farRand);
				streak += farStreak * 0.4;

				// Near layer (thick, slower, brighter)
				float nearX = floor(uv.x * 30.0);
				float nearRand = hash(vec2(nearX, 2.0));
				float nearY = fract(uv.y - uTime * (0.4 + nearRand * 0.4));
				float nearStreak = smoothstep(0.0, 0.35, nearY) * smoothstep(1.0, 0.65, nearY);
				nearStreak *= smoothstep(0.025, 0.0, abs(fract(uv.x * 30.0) - 0.5));
				nearStreak *= step(0.6 - uIntensity * 0.35, nearRand);
				streak += nearStreak * 0.7;

				// Storm adds heavier drops
				if (uIntensity > 0.6) {
					float heavyX = floor(uv.x * 20.0);
					float heavyRand = hash(vec2(heavyX, 3.0));
					float heavyY = fract(uv.y - uTime * (0.3 + heavyRand * 0.2));
					float heavyStreak = smoothstep(0.0, 0.4, heavyY) * smoothstep(1.0, 0.6, heavyY);
					heavyStreak *= smoothstep(0.04, 0.0, abs(fract(uv.x * 20.0) - 0.5));
					heavyStreak *= step(0.5, heavyRand);
					streak += heavyStreak * 0.5;
				}

				// Color: slightly blue-tinted white
				vec3 rainColor = vec3(0.75, 0.85, 1.0);

				// IMPROVED: Higher alpha for visibility (was 0.25)
				gl_FragColor = vec4(rainColor, streak * uIntensity * 0.45);
			}
		`,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	});

	// Update rain shader (animation is local to rendering, not domain state)
	let rainTime = 0;
	useTask('weather-rain', (delta) => {
		rainTime += delta;
		rainMaterial.uniforms.uTime.value = rainTime;

		// Intensity based on weather type
		const intensity = model.showRain ? (model.weather === 'storm' ? 0.9 : 0.5) : 0;
		rainMaterial.uniforms.uIntensity.value = intensity;

		// Wind effect: oscillating with turbulence influence
		const turbMult = model.turbulenceLevel === 'severe' ? 1.5 : model.turbulenceLevel === 'moderate' ? 1.0 : 0.5;
		const wind = Math.sin(rainTime * 0.3) * 0.4 * turbMult + Math.sin(rainTime * 0.7) * 0.2 * turbMult;
		rainMaterial.uniforms.uWind.value = wind;
	});

	// Cleanup
	$effect(() => {
		return () => rainMaterial.dispose();
	});
</script>

<!-- Rain overlay -->
{#if model.showRain}
	<T.Mesh position={[0, 0, -1]} renderOrder={100}>
		<T.PlaneGeometry args={[2, 2]} />
		<T is={rainMaterial} />
	</T.Mesh>
{/if}

<!-- Lightning flash (intensity from model) -->
{#if model.lightningIntensity > 0}
	<T.AmbientLight color={0xaaaaff} intensity={model.lightningIntensity * 0.5} />
{/if}
