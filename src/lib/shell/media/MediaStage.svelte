<script lang="ts">
	/**
	 * MediaStage — full-viewport video or image slideshow.
	 *
	 * Stacked above a parked GlobeLayer (Cesium warm, render loop off).
	 * Escape or SidePanel "Return to Flight" exits media mode.
	 */
	import { onDestroy } from 'svelte';
	import type { SlideshowSpec } from '$lib/fleet/display-payload';

	let {
		mode,
		videoUrl = '',
		slideshow = null,
	}: {
		mode: 'video' | 'screensaver';
		videoUrl?: string;
		slideshow?: SlideshowSpec | null;
	} = $props();

	let slideIndex = $state(0);
	/** URLs that failed this session — skipped in the rotation. */
	let failedUrls = $state<string[]>([]);
	let mediaError = $state(false);
	let timer: ReturnType<typeof setInterval> | null = null;
	let videoEl = $state<HTMLVideoElement | undefined>();

	const urls = $derived(slideshow?.urls ?? []);
	const intervalMs = $derived(Math.max(3, slideshow?.intervalSec ?? 12) * 1000);
	const playable = $derived(urls.filter((u) => !failedUrls.includes(u)));
	const currentUrl = $derived(
		playable.length > 0 ? playable[slideIndex % playable.length] : '',
	);
	const nextUrl = $derived(
		playable.length > 1 ? playable[(slideIndex + 1) % playable.length] : '',
	);

	function markFailed(url: string) {
		if (!url || failedUrls.includes(url)) return;
		failedUrls = [...failedUrls, url];
		if (mode === 'video') {
			mediaError = true;
			return;
		}
		const left = urls.filter((u) => u !== url && !failedUrls.includes(u));
		if (left.length === 0) {
			mediaError = true;
			return;
		}
		// Stay on a valid index in the remaining set.
		slideIndex = 0;
	}

	function advanceSlide() {
		if (playable.length <= 1) return;
		slideIndex = (slideIndex + 1) % playable.length;
	}

	$effect(() => {
		// Reset session failure state when playlist / mode identity changes.
		void mode;
		void videoUrl;
		void slideshow?.urls?.join('\0');
		failedUrls = [];
		mediaError = false;
		slideIndex = 0;
	});

	$effect(() => {
		// Autoplay can reject even with muted+playsinline — surface that.
		const el = videoEl;
		if (!el || mode !== 'video' || !videoUrl) return;
		const p = el.play();
		if (p && typeof p.catch === 'function') {
			p.catch(() => {
				mediaError = true;
			});
		}
	});

	$effect(() => {
		// Preload next slideshow image so LAN switches are less black-flash.
		const next = nextUrl;
		if (mode !== 'screensaver' || !next) return;
		const img = new Image();
		img.src = next;
	});

	$effect(() => {
		const list = playable;
		const ms = intervalMs;
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		if (mode !== 'screensaver' || list.length <= 1) return;
		timer = setInterval(() => {
			advanceSlide();
		}, ms);
		return () => {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		};
	});

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

<div class="media-stage" role="img" aria-label={mode === 'video' ? 'Video display' : 'Image slideshow'}>
	{#if mediaError}
		<div class="empty">
			Media failed to load
			<span class="hint">Check URL / fleet asset host · Escape or ops → Return to Flight</span>
		</div>
	{:else if mode === 'video' && videoUrl}
		<video
			bind:this={videoEl}
			class="media"
			src={videoUrl}
			autoplay
			muted
			loop
			playsinline
			onerror={() => markFailed(videoUrl)}
		></video>
	{:else if mode === 'screensaver' && currentUrl}
		{#key currentUrl}
			<img
				class="media"
				src={currentUrl}
				alt=""
				onerror={() => markFailed(currentUrl)}
			/>
		{/key}
		{#if playable.length > 1}
			<div class="dots" aria-hidden="true">
				{#each playable as _, i (i)}
					<span class={['dot', i === slideIndex % playable.length && 'on']}></span>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="empty">No media</div>
	{/if}
</div>

<style>
	.media-stage {
		position: absolute;
		inset: 0;
		background: #000;
		display: grid;
		place-items: center;
		overflow: hidden;
	}
	.media {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	img.media {
		animation: fade-in 0.6s ease;
	}
	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	.dots {
		position: absolute;
		bottom: 1.25rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 0.4rem;
		padding: 0.35rem 0.55rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.35);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.35);
	}
	.dot.on {
		background: rgba(255, 255, 255, 0.95);
	}
	.empty {
		color: rgba(255, 255, 255, 0.55);
		font-size: 0.85rem;
		letter-spacing: 0.04em;
		text-align: center;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.hint {
		font-size: 0.7rem;
		opacity: 0.65;
		letter-spacing: 0.02em;
	}
</style>
