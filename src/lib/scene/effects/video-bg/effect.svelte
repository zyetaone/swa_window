<script lang="ts">
	/**
	 * video-bg — full-scene HTML5 <video> loop.
	 *
	 * Parameterized by VideoBgParams (asset URL, fit, opacity, blend).
	 * Each registered bundle of type 'video-bg' produces one instance of this
	 * component with its own params, mounted as a DOM layer behind the clouds.
	 *
	 * Hardware: <video> uses the browser's built-in decoder. On Pi 5 this means
	 * VideoCore VII HW decode — cheap for 1080p loops, trivial for 720p.
	 */
	import type { EffectProps } from '../../types';
	import type { VideoBgParams } from './types';

	let { params }: EffectProps<VideoBgParams> = $props();
</script>

{#if params}
	<video
		class="video-bg"
		src={params.asset}
		autoplay
		loop
		muted
		playsinline
		style:object-fit={params.fit ?? 'cover'}
		style:opacity={params.opacity ?? 1}
		style:mix-blend-mode={params.blend ?? 'normal'}
	></video>
{/if}

<style>
	.video-bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
</style>
