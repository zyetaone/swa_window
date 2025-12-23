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

	// Rain shader
	const rainMaterial = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uIntensity: { value: 0 }
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
			varying vec2 vUv;

			float hash(vec2 p) {
				return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
			}

			void main() {
				float streakX = floor(vUv.x * 40.0);
				float rand = hash(vec2(streakX, 0.0));
				float streakY = fract(vUv.y - uTime * (0.5 + rand * 0.5));

				float streak = smoothstep(0.0, 0.3, streakY) * smoothstep(1.0, 0.7, streakY);
				float xDist = abs(fract(vUv.x * 40.0) - 0.5);
				streak *= smoothstep(0.02, 0.0, xDist);
				streak *= step(0.7 - uIntensity * 0.3, rand);

				gl_FragColor = vec4(0.7, 0.8, 1.0, streak * uIntensity * 0.25);
			}
		`,
		transparent: true,
		depthWrite: false
	});

	// Update rain shader (animation is local to rendering, not domain state)
	let rainTime = 0;
	useTask('weather-rain', (delta) => {
		rainTime += delta;
		rainMaterial.uniforms.uTime.value = rainTime;
		rainMaterial.uniforms.uIntensity.value = model.showRain ? (model.weather === 'storm' ? 0.8 : 0.4) : 0;
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
