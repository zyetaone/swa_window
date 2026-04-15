<script lang="ts">
	/**
	 * LocationPicker — two grids of location buttons (cities + nature scenes).
	 * Clicking triggers flyTo() so the FSM drives the transition rather than
	 * a direct lat/lon binding. Composed by SidePanel via snippet children.
	 */
	import { useAppState } from '$lib/model/state.svelte';
	import { LOCATIONS } from '$lib/locations';

	const model = useAppState();

	// "hasBuildings" is the existing flag the SidePanel shell used to split
	// the two grids — mirror here so behaviour is unchanged.
	const cities = LOCATIONS.filter((l) => l.hasBuildings);
	const nature = LOCATIONS.filter((l) => !l.hasBuildings);
</script>

<section>
	<h4>Cities</h4>
	<div class="location-grid">
		{#each cities as loc (loc.id)}
			<button
				class={['loc-btn', model.location === loc.id && 'active']}
				onclick={() => model.flyTo(loc.id)}
			>
				{loc.name}
			</button>
		{/each}
	</div>
</section>

<section>
	<h4>Nature</h4>
	<div class="location-grid">
		{#each nature as loc (loc.id)}
			<button
				class={['loc-btn', model.location === loc.id && 'active']}
				onclick={() => model.flyTo(loc.id)}
			>
				{loc.name}
			</button>
		{/each}
	</div>
</section>

<style>
	.location-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.loc-btn {
		padding: 0.45rem 0.75rem;
		font-size: 0.75rem;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 5px;
		color: white;
		cursor: pointer;
		transition: all 0.15s;
	}

	.loc-btn:hover {
		background: rgba(255, 255, 255, 0.15);
		border-color: rgba(255, 255, 255, 0.25);
	}

	.loc-btn.active {
		background: rgba(48, 76, 178, 0.4);
		border-color: var(--sw-blue);
		box-shadow: 0 0 8px rgba(48, 76, 178, 0.4);
	}
</style>
