<script lang="ts">
	/**
	 * Blind — the cabin-plastic pull-down shade over the oval viewport.
	 *
	 * Drag-snap controller is the existing `useBlind()` composable; this
	 * component only owns the markup + styles. Three downward chevrons
	 * below the pull-tab ("from → to" hint) show once per session until
	 * the user first interacts.
	 *
	 * Depends on parent `.window-container` exposing `--inner-radius` and
	 * `--frame-width` CSS custom properties — Window.svelte defines them.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { useBlind } from '../use-blind.svelte';

	const model = useAeroWindow();
	const blind = useBlind(model);
</script>

<div class="blind-clip" bind:this={blind.clipEl}>
	<div
		class={['blind-overlay', !model.blindOpen && !blind.hasAnimated && 'discoverable']}
		onanimationend={() => { blind.hasAnimated = true; }}
		onpointerdown={blind.onPointerDown}
		onpointermove={blind.onPointerMove}
		onpointerup={blind.onPointerUp}
		onkeydown={blind.onKeyDown}
		role="slider"
		tabindex={0}
		aria-label="Window blind — drag to open or close"
		aria-valuenow={Math.round(Math.abs(blind.dragY))}
		aria-valuemin={0}
		aria-valuemax={105}
		style:transform={blind.transform}
		style:transition={blind.transition}
		style:pointer-events={model.blindOpen ? 'none' : 'auto'}
	>
		<div class="blind-slats"></div>
		{#if !model.blindOpen && !blind.hasAnimated}
			<div class="pull-hint" aria-hidden="true">
				<span class="chev chev-1">▼</span>
				<span class="chev chev-2">▼</span>
				<span class="chev chev-3">▼</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.blind-clip {
		position: absolute;
		inset: var(--frame-width);
		border-radius: var(--inner-radius);
		overflow: hidden;
		z-index: 5;
		pointer-events: none;
	}

	.blind-overlay {
		position: absolute;
		inset: 0;
		border-radius: var(--inner-radius);
		background:
			linear-gradient(
				180deg,
				#efece6 0%,
				#e8e4dd 35%,
				#e1ddd5 65%,
				#d6d1c8 100%
			);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		padding: 0;
		pointer-events: auto;
		touch-action: none;
		box-shadow:
			inset 0 2px 4px rgba(255, 255, 255, 0.6),
			inset 0 -6px 12px rgba(0, 0, 0, 0.15);
	}

	.blind-slats {
		position: absolute;
		inset: 0;
		/* Each slat: 2px highlight, 8px face, 1px cast shadow — reads as
		   real louvers with depth. */
		background: repeating-linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.12) 0px,
			rgba(255, 255, 255, 0.12) 2px,
			rgba(230, 227, 221, 0.55) 2px,
			rgba(220, 217, 211, 0.55) 10px,
			rgba(0, 0, 0, 0.12) 10px,
			rgba(0, 0, 0, 0.12) 11px
		);
		/* Cylindrical shading — darker edges imply blind curvature. */
		mask-image: linear-gradient(
			90deg,
			rgba(0, 0, 0, 0.75) 0%,
			rgba(0, 0, 0, 1) 20%,
			rgba(0, 0, 0, 1) 80%,
			rgba(0, 0, 0, 0.75) 100%
		);
	}

	/* Pull-tab handle — recessed rectangle with grip ridges + drop shadow. */
	.blind-overlay::after {
		content: "";
		position: absolute;
		bottom: 10%;
		left: 50%;
		width: 56px;
		height: 18px;
		transform: translateX(-50%);
		background:
			repeating-linear-gradient(
				180deg,
				transparent 0px,
				transparent 3px,
				rgba(0, 0, 0, 0.22) 3px,
				rgba(0, 0, 0, 0.22) 4px
			),
			linear-gradient(180deg, #d8d4cc 0%, #a89f92 100%);
		border-radius: 9px;
		box-shadow:
			0 2px 5px rgba(0, 0, 0, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.6),
			inset 0 -1px 0 rgba(0, 0, 0, 0.25);
	}

	/* First-view "drag me" hint — tab bobs down-and-up 3× to signal direction. */
	@keyframes handle-breathe {
		0%, 100% { transform: translateX(-50%) translateY(0); opacity: 0.9; }
		50%      { transform: translateX(-50%) translateY(4px); opacity: 1; }
	}

	.blind-overlay.discoverable::after {
		animation: handle-breathe 1.2s ease-in-out 3;
	}

	/* Three cascading chevrons below tab — reinforces pull direction. */
	.pull-hint {
		position: absolute;
		bottom: 3%;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		pointer-events: none;
		opacity: 0.55;
	}
	.chev {
		font-size: 14px;
		color: rgba(0, 0, 0, 0.35);
		animation: chev-cascade 1.6s ease-in-out infinite;
	}
	.chev-1 { animation-delay: 0.0s; }
	.chev-2 { animation-delay: 0.2s; }
	.chev-3 { animation-delay: 0.4s; }

	@keyframes chev-cascade {
		0%, 100% { opacity: 0.25; transform: translateY(0); }
		50%      { opacity: 0.85; transform: translateY(3px); }
	}
</style>
