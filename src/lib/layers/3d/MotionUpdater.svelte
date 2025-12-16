<script lang="ts">
	/**
	 * MotionUpdater - Updates the motion system each frame
	 *
	 * Must be placed inside a Threlte Canvas to use useTask.
	 * Handles engine vibration, turbulence, and banking motion.
	 */
	import { useTask } from '@threlte/core';
	import { getMotionSystem } from '$lib/core/MotionSystem.svelte';

	const motion = getMotionSystem();

	// Update motion system every frame
	useTask((delta) => {
		motion.update(delta);
	});
</script>
