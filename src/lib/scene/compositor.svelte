<script lang="ts">
	/**
	 * Compositor — iterates the merged effect list (static registry + dynamic
	 * bundles) and mounts each effect in its own absolutely-positioned layer
	 * div at its declared z-index.
	 *
	 * Effects that expose a `when` predicate are reactively mounted/unmounted —
	 * Svelte's {#if} tracks the predicate and tears down state cleanly on exit.
	 */
	import { useAppState } from '$lib/model/state.svelte';
	import { EFFECTS } from './registry';
	import { bundleStore } from './bundle/store.svelte';

	const model = useAppState();

	// Merge static (baked-in) + dynamic (bundles pushed at runtime).
	// Reactive via bundleStore.effects — additions/removals re-render.
	const allEffects = $derived([...EFFECTS, ...bundleStore.effects]);
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
