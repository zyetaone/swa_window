<script lang="ts">
	/**
	 * Drives the synthesized cabin ambience from live scene state.
	 *
	 * Renders nothing. Deliberately takes plain props rather than reaching into
	 * the AeroWindow context: that keeps the audio graph drivable from the lab
	 * route, a test, or a future preview surface without any of them having to
	 * construct a model.
	 *
	 * The `enabled` default is false (see config-tree), so on a stock kiosk this
	 * component allocates nothing at all — `apply()` returns before touching the
	 * Web Audio API.
	 */
	import { onDestroy } from 'svelte';
	import { AmbientAudio } from './ambient-audio';
	import { config } from '$lib/model/config-tree.svelte';
	import { WEATHER_EFFECTS } from '$content/weather';
	import type { WeatherType } from '$lib/types';

	const { altitudeFt, weather, isLeader }: {
		altitudeFt: number;
		weather: WeatherType;
		isLeader: boolean;
	} = $props();

	const audio = new AmbientAudio();

	// rainOpacity is already "how wet is this weather" on a 0..1-ish scale, so
	// the weather layer rides the same recipe the visuals do rather than a
	// second hand-maintained mapping that could disagree with the rain on glass.
	const wet = $derived(Math.min(1, WEATHER_EFFECTS[weather]?.rainOpacity ?? 0));

	$effect(() => {
		audio.apply(
			{
				enabled: config.audio.enabled,
				masterVolume: config.audio.masterVolume,
				engineVolume: config.audio.engineVolume,
				weatherVolume: config.audio.weatherVolume,
				musicVolume: config.audio.musicVolume,
				musicUrl: config.audio.musicUrl,
			},
			{ altitudeFt, wet, musicAllowed: isLeader },
		);
	});

	// Browsers hold the context suspended until a gesture. The kiosk ships
	// --autoplay-policy=no-user-gesture-required so this only matters in dev and
	// on the admin iPad; harmless either way, and removed after it fires once.
	function unlock(): void {
		audio.resume();
	}

	onDestroy(() => audio.dispose());
</script>

<svelte:window onpointerdown={unlock} ontouchstart={unlock} />
