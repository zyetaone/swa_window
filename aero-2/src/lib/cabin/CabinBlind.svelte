<script lang="ts">
	/**
	 * CabinBlind — realistic pull-down airplane window shade.
	 */
	interface Props {
		/** Closed fraction: 0 (fully open) to 1 (fully closed). */
		closed?: number;
	}

	let { closed = $bindable(0) }: Props = $props();

	let isDragging = $state(false);
	let startY = 0;
	let startClosed = 0;

	function onPointerDown(e: PointerEvent) {
		isDragging = true;
		startY = e.clientY;
		startClosed = closed;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		const delta = (e.clientY - startY) / window.innerHeight;
		closed = Math.max(0, Math.min(1, startClosed + delta));
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		if (closed < 0.12) closed = 0;
		if (closed > 0.88) closed = 1;
		try {
			(e.target as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			/* pointer already released */
		}
	}
</script>

<div class="cabin-blind-container" style:--closed={closed} class:dragging={isDragging}>
	<div class="blind-surface">
		<div class="blind-ribs"></div>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="blind-handle"
			role="slider"
			aria-label="Window blind"
			aria-valuenow={Math.round(closed * 100)}
			aria-valuemin={0}
			aria-valuemax={100}
			tabindex={0}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
		>
			<div class="handle-grip"></div>
		</div>
	</div>
</div>

<style>
	.cabin-blind-container {
		position: fixed;
		inset: 0;
		z-index: 25;
		pointer-events: none;
		overflow: hidden;
	}

	.blind-surface {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 100%;
		background: linear-gradient(180deg, #1c222b 0%, #151a21 100%);
		transform: translateY(calc(-100% + (var(--closed) * 100%)));
		transition: transform 0.05s linear;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
		border-bottom: 2px solid rgba(255, 255, 255, 0.08);
	}

	.cabin-blind-container:not(.dragging) .blind-surface {
		transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.blind-ribs {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.015) 0px,
			rgba(255, 255, 255, 0.015) 18px,
			rgba(0, 0, 0, 0.25) 19px,
			rgba(0, 0, 0, 0.25) 20px
		);
	}

	.blind-handle {
		position: absolute;
		bottom: -18px;
		left: 50%;
		transform: translateX(-50%);
		width: 80px;
		height: 28px;
		background: #252d38;
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: grab;
		pointer-events: auto;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
		touch-action: none;
	}

	.blind-handle:active {
		cursor: grabbing;
	}

	.handle-grip {
		width: 36px;
		height: 4px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.35);
	}
</style>
