<script lang="ts">
	/**
	 * WindowFrame — oval airplane cabin window bezel with depth and inner shadow.
	 */
	interface Props {
		visible?: boolean;
	}

	const { visible = true }: Props = $props();
</script>

{#if visible}
	<div class="window-bezel" aria-hidden="true">
		<div class="bezel-inner"></div>
	</div>
{/if}

<style>
	.window-bezel {
		position: fixed;
		inset: 0;
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: inset 0 0 80px 40px rgba(0, 0, 0, 0.85);
		z-index: 20;
	}

	.bezel-inner {
		position: absolute;
		inset: 12px;
		border-radius: 42px;
		border: 1.5px solid rgba(255, 255, 255, 0.08);
		box-shadow:
			inset 0 0 30px rgba(0, 0, 0, 0.6),
			0 0 0 12px rgba(18, 22, 28, 0.95);
		pointer-events: none;
	}
</style>
