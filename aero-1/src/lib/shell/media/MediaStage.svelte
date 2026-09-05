<script lang="ts">
	/**
	 * MediaStage — full-viewport video or image slideshow.
	 *
	 * Stacked above a parked GlobeLayer (Cesium warm, render loop off).
	 * Exit: Escape, SidePanel "Return to Flight", or long-press (~1.2s) on the
	 * stage (edge panes without ops chrome / no keyboard).
	 */
	import { onDestroy } from 'svelte';
	import type { SlideshowSpec } from '$lib/fleet/display-payload';
	import { tryUseAeroWindow } from '$lib/model/aero-window.svelte';

	let {
		mode,
		videoUrl = '',
		slideshow = null,
	}: {
		mode: 'video' | 'screensaver';
		videoUrl?: string;
		slideshow?: SlideshowSpec | null;
	} = $props();

	const model = tryUseAeroWindow();

	let slideIndex = $state(0);
	/** URLs that failed this session — skipped in the rotation. */
	let failedUrls = $state<string[]>([]);
	let mediaError = $state(false);
	let timer: ReturnType<typeof setInterval> | null = null;
	let videoEl = $state<HTMLVideoElement | undefined>();
	let autoFlightTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressMoved = false;
	let longPressX = 0;
	let longPressY = 0;

	const LONG_PRESS_MS = 1200;
	const LONG_PRESS_MOVE_PX = 16;
	/** After total media failure, return to flight so the wall is not stuck black. */
	const AUTO_FLIGHT_AFTER_MS = 4000;

	const urls = $derived(slideshow?.urls ?? []);
	const intervalMs = $derived(Math.max(3, slideshow?.intervalSec ?? 12) * 1000);
	const playable = $derived(urls.filter((u) => !failedUrls.includes(u)));
	const currentUrl = $derived(
		playable.length > 0 ? playable[slideIndex % playable.length] : '',
	);
	const nextUrl = $derived(
		playable.length > 1 ? playable[(slideIndex + 1) % playable.length] : '',
	);

	function reportMediaError(url: string, reason: string) {
		model?.telemetry?.recordEvent('info', {
			event: 'media_error',
			mode,
			url: url.slice(0, 200),
			reason,
		});
	}

	function scheduleAutoFlight() {
		if (autoFlightTimer) clearTimeout(autoFlightTimer);
		autoFlightTimer = setTimeout(() => {
			autoFlightTimer = null;
			model?.setDisplayMode('flight');
		}, AUTO_FLIGHT_AFTER_MS);
	}

	function markFailed(url: string) {
		if (!url || failedUrls.includes(url)) return;
		const nextFailed = [...failedUrls, url];
		failedUrls = nextFailed;
		reportMediaError(url, 'load_failed');
		if (mode === 'video') {
			mediaError = true;
			scheduleAutoFlight();
			return;
		}
		const remaining = urls.filter((u) => !nextFailed.includes(u));
		if (remaining.length === 0) {
			mediaError = true;
			scheduleAutoFlight();
			return;
		}
		// Keep index in range of the remaining playlist (no hard reset to 0).
		slideIndex = slideIndex % remaining.length;
	}

	function advanceSlide() {
		if (playable.length <= 1) return;
		slideIndex = (slideIndex + 1) % playable.length;
	}

	function clearLongPress() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function onStagePointerDown(e: PointerEvent) {
		longPressMoved = false;
		longPressX = e.clientX;
		longPressY = e.clientY;
		clearLongPress();
		longPressTimer = setTimeout(() => {
			longPressTimer = null;
			if (longPressMoved) return;
			model?.setDisplayMode('flight');
		}, LONG_PRESS_MS);
	}

	function onStagePointerMove(e: PointerEvent) {
		if (longPressMoved) return;
		if (Math.hypot(e.clientX - longPressX, e.clientY - longPressY) > LONG_PRESS_MOVE_PX) {
			longPressMoved = true;
			clearLongPress();
		}
	}

	function onStagePointerUp() {
		clearLongPress();
	}

	$effect(() => {
		// Reset session failure state when playlist / mode identity changes.
		void mode;
		void videoUrl;
		void slideshow?.urls?.join('\0');
		failedUrls = [];
		mediaError = false;
		slideIndex = 0;
		if (autoFlightTimer) {
			clearTimeout(autoFlightTimer);
			autoFlightTimer = null;
		}
	});

	$effect(() => {
		// Autoplay can reject even with muted+playsinline — surface that.
		const el = videoEl;
		if (!el || mode !== 'video' || !videoUrl) return;
		const p = el.play();
		if (p && typeof p.catch === 'function') {
			p.catch(() => {
				reportMediaError(videoUrl, 'autoplay_rejected');
				mediaError = true;
				scheduleAutoFlight();
			});
		}
	});

	$effect(() => {
		// Preload next slideshow image so LAN switches are less black-flash.
		const next = nextUrl;
		if (mode !== 'screensaver' || !next) return;
		const img = new Image();
		img.src = next;
		return () => {
			img.src = '';
		};
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
		if (autoFlightTimer) clearTimeout(autoFlightTimer);
		clearLongPress();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="media-stage"
	role="img"
	aria-label={mode === 'video' ? 'Video display' : 'Image slideshow'}
	onpointerdown={onStagePointerDown}
	onpointermove={onStagePointerMove}
	onpointerup={onStagePointerUp}
	onpointercancel={onStagePointerUp}
	onpointerleave={onStagePointerUp}
>
	{#if mediaError}
		<div class="empty">
			Media failed to load
			<span class="hint">Returning to flight… Escape / long-press / ops to exit sooner</span>
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
		touch-action: manipulation;
		user-select: none;
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
		pointer-events: none;
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
		pointer-events: none;
	}
	.hint {
		font-size: 0.7rem;
		opacity: 0.65;
		letter-spacing: 0.02em;
	}
</style>
