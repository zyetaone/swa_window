<script lang="ts">
	/**
	 * Scene3DOverlay - Enhanced Three.js overlay for realistic flight view
	 *
	 * Renders on top of Cesium with transparent background
	 * Follows Threlte best practice: Canvas wrapper + separate Scene component
	 */
	import { Canvas } from "@threlte/core";
	import * as THREE from "three";
	import Scene from "./3d/Scene.svelte";
</script>

<div class="scene-overlay">
	<Canvas
		createRenderer={(canvas) => {
			return new THREE.WebGLRenderer({
				canvas,
				alpha: true,
				antialias: true,
				powerPreference: "high-performance",
				logarithmicDepthBuffer: true,
			});
		}}
	>
		<!-- All scene content extracted to Scene.svelte (Threlte best practice) -->
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
		z-index: 10;
	}

	.scene-overlay :global(div) {
		width: 100% !important;
		height: 100% !important;
	}

	.scene-overlay :global(canvas) {
		width: 100% !important;
		height: 100% !important;
		display: block;
	}
</style>
