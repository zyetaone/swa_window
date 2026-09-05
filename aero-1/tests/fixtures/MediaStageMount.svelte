<script lang="ts">
	/**
	 * Test fixture: MediaStage under AeroWindow context for unit mounts.
	 */
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import type { AeroWindow } from '$lib/model/aero-window.svelte';
	import MediaStage from '$lib/shell/media/MediaStage.svelte';
	import type { SlideshowSpec } from '$lib/fleet/display-payload';

	let {
		onprovide,
		mode = 'video',
		videoUrl = '',
		slideshow = null,
	}: {
		onprovide: (model: AeroWindow) => void;
		mode?: 'video' | 'screensaver';
		videoUrl?: string;
		slideshow?: SlideshowSpec | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	onprovide(createAeroWindow());
</script>

<div class="wrap">
	<MediaStage {mode} {videoUrl} {slideshow} />
</div>

<style>
	.wrap {
		position: relative;
		width: 320px;
		height: 180px;
	}
</style>
