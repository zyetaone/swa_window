<script lang="ts">
	/**
	 * CloudCanvas - Threlte-powered volumetric cloud overlay
	 *
	 * Renders raymarched FBM clouds on a transparent WebGL canvas.
	 * Designed to overlay Cesium at z:1 with pointer-events: none.
	 */
	import { Canvas } from '@threlte/core';
	import * as THREE from 'three';
	import VolumetricClouds from './VolumetricClouds.svelte';

	interface Props {
		density?: number;
		cloudSpeed?: number;
		nightFactor?: number;
		dawnDuskFactor?: number;
		skyState?: 'day' | 'night' | 'dawn' | 'dusk';
		time?: number;
	}

	let {
		density = 0.5,
		cloudSpeed = 1.0,
		nightFactor = 0,
		dawnDuskFactor = 0,
		skyState = 'day',
		time = 0,
	}: Props = $props();
</script>

<div class="cloud-canvas-wrapper">
	<Canvas
		createRenderer={(canvas) => {
			return new THREE.WebGLRenderer({
				canvas,
				alpha: true,
				antialias: false,
				powerPreference: 'high-performance',
				premultipliedAlpha: false,
			});
		}}
		renderMode="manual"
		autoRender={false}
	>
		<VolumetricClouds
			{density}
			{cloudSpeed}
			{nightFactor}
			{dawnDuskFactor}
			{skyState}
			{time}
		/>
	</Canvas>
</div>

<style>
	.cloud-canvas-wrapper {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 1;
	}

	.cloud-canvas-wrapper :global(canvas) {
		width: 100% !important;
		height: 100% !important;
	}
</style>
