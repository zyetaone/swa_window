<script lang="ts">
	/**
	 * SparkleField — cabin-air dust motes that track the camera.
	 * Part of the hybrid artistic layer set (see ThreeOverlay.svelte).
	 *
	 * Threlte's <Sparkles> lives at scene origin by default; when the
	 * camera flies away from origin (WGS84 scale = millions of metres)
	 * the sparkles fall out of view. Wrapping in a T.Group whose position
	 * we update each frame to follow the camera keeps them perpetually
	 * "in cabin air" regardless of flight position.
	 *
	 * Drift speed + noise come from Sparkles' own animation — the wrapper
	 * just translates. The group has no rotation tracking so the sparkles
	 * don't shear when the camera banks.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import { Sparkles } from '@threlte/extras';
	import type { Group as ThreeGroup } from 'three';

	const ctx = useThrelte();

	let group = $state.raw<ThreeGroup | undefined>();

	useTask(() => {
		if (!group) return;
		const camPos = ctx.camera.current.position;
		group.position.set(camPos.x, camPos.y, camPos.z);
	});
</script>

<T.Group bind:ref={group}>
	<Sparkles
		count={80}
		size={1.6}
		scale={[5000, 1500, 5000]}
		speed={0.4}
		opacity={0.45}
		color="#fff6e0"
		noise={0.6}
	/>
</T.Group>
