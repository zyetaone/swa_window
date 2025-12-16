<script lang="ts">
	/**
	 * VolumetricClouds - Realistic cloud rendering
	 *
	 * Features:
	 * - Multiple cloud layers (cumulus, stratus, cirrus)
	 * - Ray-marched volumetric appearance
	 * - Time-of-day lighting
	 * - Self-shadowing
	 * - Altitude-appropriate cloud types
	 */

	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { getViewerState } from '$lib/core/state.svelte';
	import { UNITS } from '$lib/core/constants';
	import {
		volumetricCloudVertexShader,
		volumetricCloudFragmentShader,
		volumetricCloudUniforms
	} from '$lib/shaders/volumetricClouds';

	const viewer = getViewerState();

	// Create geometry once - reused across all cloud instances
	const cloudGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);

	// Cleanup effect for geometry disposal
	$effect(() => {
		return () => {
			cloudGeometry.dispose();
			cloudShaderMaterial.dispose();
		};
	});

	// Cloud layer definitions based on real meteorology
	interface CloudLayer {
		id: string;
		name: string;
		altitudeMin: number; // feet
		altitudeMax: number;
		type: 'cumulus' | 'stratus' | 'cirrus';
		density: number;
		scale: number;
	}

	const CLOUD_LAYERS: CloudLayer[] = [
		{
			id: 'ground-fog',
			name: 'Ground Fog',
			altitudeMin: 0,
			altitudeMax: 3000,
			type: 'stratus',
			density: 0.4,
			scale: 3.0
		},
		{
			id: 'low-cumulus',
			name: 'Low Cumulus',
			altitudeMin: 3000,
			altitudeMax: 8000,
			type: 'cumulus',
			density: 0.9,
			scale: 1.2
		},
		{
			id: 'mid-cumulus',
			name: 'Mid Cumulus',
			altitudeMin: 8000,
			altitudeMax: 15000,
			type: 'cumulus',
			density: 0.7,
			scale: 1.5
		},
		{
			id: 'mid-stratus',
			name: 'Mid Stratus',
			altitudeMin: 12000,
			altitudeMax: 20000,
			type: 'stratus',
			density: 0.6,
			scale: 2.5
		},
		{
			id: 'high-stratus',
			name: 'High Stratus',
			altitudeMin: 20000,
			altitudeMax: 30000,
			type: 'stratus',
			density: 0.5,
			scale: 3.0
		},
		{
			id: 'high-cirrus',
			name: 'High Cirrus',
			altitudeMin: 28000,
			altitudeMax: 42000,
			type: 'cirrus',
			density: 0.4,
			scale: 4.0
		},
		{
			id: 'ice-crystals',
			name: 'Ice Crystals',
			altitudeMin: 35000,
			altitudeMax: 50000,
			type: 'cirrus',
			density: 0.25,
			scale: 5.0
		}
	];

	// Create shader material using external shaders
	const cloudShaderMaterial = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: volumetricCloudUniforms.uTime.value },
			uSunDirection: { value: new THREE.Vector3(...volumetricCloudUniforms.uSunDirection.value) },
			uSunColor: { value: new THREE.Color(...volumetricCloudUniforms.uSunColor.value) },
			uCloudDensity: { value: volumetricCloudUniforms.uCloudDensity.value },
			uCloudCoverage: { value: volumetricCloudUniforms.uCloudCoverage.value },
			uCloudAltitude: { value: volumetricCloudUniforms.uCloudAltitude.value },
			uViewerAltitude: { value: volumetricCloudUniforms.uViewerAltitude.value }
		},
		vertexShader: volumetricCloudVertexShader,
		fragmentShader: volumetricCloudFragmentShader,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide
	});

	// Generate cloud instances
	interface CloudInstance {
		position: [number, number, number];
		scale: [number, number, number];
		rotation: number;
		layer: CloudLayer;
	}

	function generateClouds(): CloudInstance[] {
		const clouds: CloudInstance[] = [];
		const viewerAlt = viewer.altitude;

		for (const layer of CLOUD_LAYERS) {
			// Calculate distance from viewer to layer center
			const layerCenter = (layer.altitudeMin + layer.altitudeMax) / 2;
			const altDistance = Math.abs(viewerAlt - layerCenter);

			// Skip layers too far from viewer (but keep more visible)
			if (altDistance > 30000) {
				continue;
			}

			// More clouds when closer to layer, weather-dependent
			const weatherMultiplier =
				viewer.weather === 'storm' ? 1.8 :
				viewer.weather === 'overcast' ? 1.5 :
				viewer.weather === 'cloudy' ? 1.2 : 1.0;

			// Proximity factor - more clouds when in/near layer
			const proximityFactor = Math.max(0.3, 1 - altDistance / 30000);

			// Number of clouds based on density, weather, and proximity
			const count = Math.floor(50 * layer.density * viewer.cloudDensity * weatherMultiplier * proximityFactor);

			for (let i = 0; i < count; i++) {
				// Random position in a sphere around viewer
				const angle = Math.random() * Math.PI * 2;
				const distance = 3000 + Math.random() * 40000;
				const altitude = layer.altitudeMin + Math.random() * (layer.altitudeMax - layer.altitudeMin);

				// Convert altitude from feet to scene units (meters)
				const altMeters = altitude * UNITS.FEET_TO_METERS;
				const viewerAltMeters = viewerAlt * UNITS.FEET_TO_METERS;

				clouds.push({
					position: [
						Math.cos(angle) * distance,
						altMeters - viewerAltMeters,
						Math.sin(angle) * distance
					],
					scale: [
						(1500 + Math.random() * 3000) * layer.scale,
						(800 + Math.random() * 1500) * layer.scale,
						1
					],
					rotation: Math.random() * Math.PI * 2,
					layer
				});
			}
		}

		return clouds;
	}

	let clouds = $state<CloudInstance[]>([]);
	let time = 0;
	let lastRegenAltitude = 0;
	let lastRegenDensity = 0;

	// Regenerate clouds only when altitude/density changes significantly
	// Avoids expensive regeneration every frame during flight
	$effect(() => {
		const altDelta = Math.abs(viewer.altitude - lastRegenAltitude);
		const densityDelta = Math.abs(viewer.cloudDensity - lastRegenDensity);

		// Only regenerate if altitude changed by 5000ft or density by 0.2
		if (altDelta > 5000 || densityDelta > 0.2 || clouds.length === 0) {
			clouds = generateClouds();
			lastRegenAltitude = viewer.altitude;
			lastRegenDensity = viewer.cloudDensity;
		}
	});

	// Update shader uniforms
	$effect(() => {
		// Sun direction from viewer state
		const sunPos = viewer.sunPosition;
		cloudShaderMaterial.uniforms.uSunDirection.value.set(sunPos.x, sunPos.y, sunPos.z).normalize();

		// Sun color based on time
		if (viewer.skyState === 'dawn' || viewer.skyState === 'dusk') {
			cloudShaderMaterial.uniforms.uSunColor.value.set(1.0, 0.7, 0.5);
		} else if (viewer.skyState === 'night') {
			cloudShaderMaterial.uniforms.uSunColor.value.set(0.3, 0.35, 0.5);
		} else {
			cloudShaderMaterial.uniforms.uSunColor.value.set(1.0, 0.98, 0.95);
		}

		// Update cloud density and coverage based on viewer state
		cloudShaderMaterial.uniforms.uCloudDensity.value = viewer.cloudDensity;
		cloudShaderMaterial.uniforms.uCloudCoverage.value = viewer.cloudDensity; // Use cloudDensity for coverage

		// Update viewer altitude for shader calculations
		cloudShaderMaterial.uniforms.uViewerAltitude.value = viewer.altitude * UNITS.FEET_TO_METERS;
	});

	// Animation
	useTask((delta) => {
		time += delta;
		cloudShaderMaterial.uniforms.uTime.value = time;
	});
</script>

{#if viewer.showClouds}
	{#each clouds as cloud, i (i)}
		<T.Mesh
			position={cloud.position}
			scale={cloud.scale}
			rotation.y={cloud.rotation}
		>
			<T is={cloudGeometry} />
			<T is={cloudShaderMaterial} />
		</T.Mesh>
	{/each}
{/if}
