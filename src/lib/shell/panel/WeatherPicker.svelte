<script lang="ts">
	/**
	 * WeatherPicker — weather-type button grid. Goes through applyPatch so
	 * the user-override timer + WeatherConfig sync helper fire correctly.
	 */
	import { useAppState } from '$lib/model/state.svelte';
	import { WEATHER_TYPES } from '$lib/types';

	const model = useAppState();
</script>

<section>
	<h4>Weather</h4>
	<div class="weather-grid">
		{#each WEATHER_TYPES as w (w)}
			<button
				class={['weather-btn', model.weather === w && 'active']}
				onclick={() => model.applyPatch({ weather: w })}
			>
				{w[0].toUpperCase() + w.slice(1)}
			</button>
		{/each}
	</div>
</section>

<style>
	.weather-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.weather-btn {
		padding: 0.45rem 0.75rem;
		font-size: 0.75rem;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 5px;
		color: rgba(255, 255, 255, 0.7);
		cursor: pointer;
		text-align: center;
		transition: all 0.2s;
	}
	.weather-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: white;
	}
	.weather-btn.active {
		background: rgba(48, 76, 178, 0.5);
		border-color: var(--sw-blue);
		color: white;
		font-weight: 500;
	}
</style>
