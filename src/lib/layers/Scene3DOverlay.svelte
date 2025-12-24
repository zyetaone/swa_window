<script lang="ts">
	/**
	 * Scene3DOverlay - Three.js overlay for clouds/effects
	 * Renders on top of Cesium with transparent background
	 */
	import { Canvas } from "@threlte/core";
	import * as THREE from "three";
	import Scene from "./3d/Scene.svelte";
</script>

<div class="scene-overlay">
	<Canvas
		createRenderer={(canvas) => {
			const renderer = new THREE.WebGLRenderer({
				canvas,
				alpha: true,
				antialias: true,
			});
			renderer.setClearColor(0x000000, 0);
			return renderer;
		}}
	>
		<Scene />
	</Canvas>
</div>

<style>
	.scene-overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	/* Ensure Threlte's wrapper divs fill the space */
	.scene-overlay :global(div) {
		width: 100% !important;
		height: 100% !important;
	}

	.scene-overlay :global(canvas) {
		width: 100% !important;
		height: 100% !important;
		display: block !important;
	}
</style>
