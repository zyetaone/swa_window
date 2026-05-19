<script lang="ts">
	/**
	 * WeatherPicker — weather-type button grid. Goes through the typed
	 * setter so the user-override timer + WeatherConfig sync helper fire
	 * correctly.
	 *
	 * Button + grid styling comes from SidePanel's shared .picker-btn /
	 * .picker-grid :global rules.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { WEATHER_TYPES } from '$lib/types';

	const model = useAeroWindow();
</script>

<section>
	<h4>Weather</h4>
	<div class="picker-grid">
		{#each WEATHER_TYPES as w (w)}
			<button
				class={['picker-btn', model.weather === w && 'active']}
				onclick={() => model.setWeather(w)}
			>
				{w[0].toUpperCase() + w.slice(1)}
			</button>
		{/each}
	</div>
</section>
