<script lang="ts">
	/**
	 * LocationPicker — two grids of location buttons (cities + nature scenes).
	 * Clicking triggers flyTo() so the FSM drives the transition rather than
	 * a direct lat/lon binding. Composed by SidePanel via snippet children.
	 *
	 * Button + grid styling comes from SidePanel's shared .picker-btn /
	 * .picker-grid :global rules.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { LOCATIONS } from '$content/locations';

	const model = useAeroWindow();

	// "hasBuildings" is the existing flag the SidePanel shell used to split
	// the two grids — mirror here so behaviour is unchanged.
	const cities = LOCATIONS.filter((l) => l.hasBuildings);
	const nature = LOCATIONS.filter((l) => !l.hasBuildings);
</script>

<!-- One grid definition for both sections: the active-state class and the
     flyTo() call must stay identical, and were previously written twice. -->
{#snippet grid(title: string, locs: typeof LOCATIONS)}
	<section>
		<h4>{title}</h4>
		<div class="picker-grid">
			{#each locs as loc (loc.id)}
				<button
					class={['picker-btn', model.location === loc.id && 'active']}
					onclick={() => model.flyTo(loc.id)}
				>
					{loc.name}
				</button>
			{/each}
		</div>
	</section>
{/snippet}

{@render grid('Cities', cities)}
{@render grid('Nature', nature)}
