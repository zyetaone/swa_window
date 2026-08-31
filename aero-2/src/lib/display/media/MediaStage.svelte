<script lang="ts">
	/**
	 * MediaStage — Fullscreen video player or photo slideshow for non-flight kiosk modes.
	 * Supports single video loops, video playlists, and image slideshows.
	 */
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();

	let failedUrls = $state<string[]>([]);
	let mediaError = $state(false);

	const mode = $derived(display.config.displayMode);

	// Video playlist calculation
	const videoList = $derived(
		display.config.videoPlaylist.length > 0
			? display.config.videoPlaylist
			: display.config.videoUrl
				? [display.config.videoUrl]
				: []
	);
	const activeVideoUrl = $derived(
		videoList.length > 0 ? videoList[display.config.videoIndex % videoList.length] : ''
	);

	// Image slideshow calculation
	const urls = $derived(display.config.screensaverUrls);
	const playableImages = $derived(urls.filter((u) => !failedUrls.includes(u)));
	/**
	 * Which slide, derived from the wall clock rather than counted.
	 *
	 * `(slideIndex + 1) % n` on a private 10 s interval is a per-process
	 * sequence: three Pis boot seconds apart, so three panes of one screensaver
	 * sat on three different photographs and stayed that way. The index is a
	 * pure function of the second instead -- same rule the director already
	 * follows for the destination, and a pane that reboots rejoins mid-show
	 * instead of restarting the sequence.
	 *
	 * `display.view.wallSec` keeps ticking here: Display.svelte mounts the world
	 * unconditionally and MediaStage draws over it, so the frame loop is live
	 * even when nothing of the flight is visible.
	 */
	const SLIDE_SEC = 10;
	const slideIndex = $derived(
		playableImages.length === 0
			? 0
			: Math.floor(display.view.wallSec / SLIDE_SEC) % playableImages.length
	);

	const currentImageUrl = $derived(playableImages.length > 0 ? playableImages[slideIndex] : '');

	function markFailed(url: string) {
		if (!url || failedUrls.includes(url)) return;
		failedUrls = [...failedUrls, url];
		if (mode === 'video' || urls.filter((u) => !failedUrls.includes(u)).length === 0) {
			mediaError = true;
		}
	}

	function onVideoEnded() {
		if (videoList.length > 1) {
			display.config.videoIndex = (display.config.videoIndex + 1) % videoList.length;
		}
	}
</script>

{#if mode !== 'flight'}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="media-stage"
		role="img"
		aria-label="Media Stage"
		onclick={() => {
			display.config.displayMode = 'flight';
		}}
	>
		{#if mode === 'standby'}
			<div class="standby-screen">
				<span class="standby-hint">Touch screen or press Escape to wake</span>
			</div>
		{:else if mediaError}
			<div class="empty">
				Media failed to load
				<span class="hint">Click or press Escape to return to flight</span>
			</div>
		{:else if mode === 'video' && activeVideoUrl}
			<video
				class="media"
				src={activeVideoUrl}
				autoplay
				muted
				loop={videoList.length <= 1}
				playsinline
				onended={onVideoEnded}
				onerror={() => markFailed(activeVideoUrl)}
			></video>
		{:else if mode === 'screensaver' && currentImageUrl}
			{#key currentImageUrl}
				<img
					class="media"
					src={currentImageUrl}
					alt=""
					onerror={() => markFailed(currentImageUrl)}
				/>
			{/key}
		{:else}
			<div class="empty">
				No media specified
				<span class="hint">Click to return to flight</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.media-stage {
		position: absolute;
		inset: 0;
		background: #000;
		display: grid;
		place-items: center;
		overflow: hidden;
		z-index: 25;
		cursor: pointer;
	}
	.media {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		pointer-events: none;
	}
	img.media {
		animation: fade-in 0.6s ease;
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.empty,
	.standby-screen {
		color: rgba(255, 255, 255, 0.55);
		font-size: 0.85rem;
		text-align: center;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.hint,
	.standby-hint {
		font-size: 0.7rem;
		opacity: 0.65;
	}
</style>
