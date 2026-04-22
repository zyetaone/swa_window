<script lang="ts">
	/**
	 * TransparentClear — mounted inside a Threlte <Canvas> to force its
	 * WebGLRenderer to clear with alpha:0 each frame. Without this, the
	 * Canvas paints solid black (its default clear color) over the DOM
	 * siblings below it — in our case the MapLibre globe would be
	 * hidden. Use in SceneCell's Canvas when the cell renders any
	 * Three.js layer on top of a MapLibre base.
	 */
	import { useThrelte } from '@threlte/core';

	const { renderer } = useThrelte();

	renderer.setClearColor(0x000000, 0);
	renderer.setClearAlpha(0);
</script>
