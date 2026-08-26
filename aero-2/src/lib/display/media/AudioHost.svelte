<script lang="ts">
	/**
	 * AudioHost — Web Audio & Playlist Audio lifecycle manager.
	 * Supports:
	 * 1. Synthetic turbofan engine rumble modulated by altitude.
	 * 2. Custom audio soundscape playlist (ambient music, boarding chimes, rain, etc.)
	 */
	import { onDestroy } from 'svelte';
	import { useDisplay } from '../display.svelte.js';
	import { AmbientAudioEngine } from './ambient-audio.js';

	const display = useDisplay();
	const synthAudio = new AmbientAudioEngine();

	let initialized = false;
	let audioElement = $state<HTMLAudioElement | null>(null);

	function ensureInit() {
		if (!initialized) {
			initialized = true;
			if (display.config.audioMode === 'synth') {
				synthAudio.init();
			}
		}
	}

	const currentTrackUrl = $derived(
		display.config.audioPlaylist[display.config.audioTrackIndex] ?? ''
	);

	$effect(() => {
		if (display.config.audioEnabled) {
			ensureInit();
		}

		if (display.config.audioMode === 'synth') {
			if (audioElement) {
				audioElement.pause();
			}
			synthAudio.setVolume(display.config.audioVolume, display.config.audioEnabled);
		} else {
			synthAudio.setVolume(0, false);
			if (audioElement && currentTrackUrl) {
				if (display.config.audioEnabled) {
					audioElement.volume = Math.max(0, Math.min(1, display.config.audioVolume));
					audioElement.play().catch(() => {});
				} else {
					audioElement.pause();
				}
			}
		}
	});

	$effect(() => {
		const agl = display.view.aglM ?? 4000;
		synthAudio.setAltitude(agl);
	});

	function onTrackEnded() {
		if (display.config.audioPlaylist.length > 1) {
			display.config.audioTrackIndex =
				(display.config.audioTrackIndex + 1) % display.config.audioPlaylist.length;
		}
	}

	onDestroy(() => {
		synthAudio.destroy();
		if (audioElement) {
			audioElement.pause();
			audioElement = null;
		}
	});
</script>

<svelte:window onclick={ensureInit} onkeydown={ensureInit} />

{#if display.config.audioMode === 'playlist' && currentTrackUrl}
	<audio
		bind:this={audioElement}
		src={currentTrackUrl}
		onended={onTrackEnded}
		loop={display.config.audioPlaylist.length <= 1}
		preload="auto"
	></audio>
{/if}
