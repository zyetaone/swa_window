<script lang="ts">
	/**
	 * Compositor — iterates the merged effect list (static registry + dynamic
	 * bundles) and mounts each effect in its own absolutely-positioned layer
	 * div at its declared z-index.
	 *
	 * Effects that expose a `when` predicate are reactively mounted/unmounted —
	 * Svelte's {#if} tracks the predicate and tears down state cleanly on exit.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { EFFECTS } from './registry';
	import { bundleStore } from './bundle/store.svelte';

	const model = useAeroWindow();

	// Merge static (baked-in) + dynamic (bundles pushed at runtime).
	// Dynamic effects are filtered: if a bundle registers an id already in the
	// static registry, the static definition wins (no silent shadowing).
	const staticIds = new Set(EFFECTS.map(e => e.id));
	const allEffects = $derived([...EFFECTS, ...bundleStore.effects.filter(e => !staticIds.has(e.id))]);
</script>

{#each allEffects as effect (effect.id)}
	{#if !effect.when || effect.when(model)}
		{@const EffectComponent = effect.component}
		<div class="effect-layer" data-effect={effect.id} style:z-index={effect.z}>
			<EffectComponent {model} params={effect.params} />
		</div>
	{/if}
{/each}

<style>
	.effect-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
</style>
