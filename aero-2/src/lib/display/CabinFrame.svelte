<script lang="ts">
	/**
	 * CabinFrame — viewport-fixed container for cabin window layers.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	const { children }: Props = $props();
</script>

<div class="cabin-frame" aria-hidden="true">
	{@render children?.()}
</div>

<style>
	.cabin-frame {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		user-select: none;
		z-index: 10;
	}
</style>
