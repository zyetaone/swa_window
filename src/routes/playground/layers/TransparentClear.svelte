<script lang="ts">
	/**
	 * TransparentClear — Ensures the Threlte <Canvas> has a transparent
	 * background so the MapLibre globe underneath can show through.
	 */
	import { useThrelte } from '@threlte/core';

	const { renderer } = useThrelte();

	// Set clear color to transparent black at mount
	renderer.setClearColor(0x000000, 0);
</script>

<!-- This component has no visual representation in the scene graph -->
