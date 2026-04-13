<script lang="ts">
	/**
	 * Blind - Draggable airplane window blind overlay
	 *
	 * Self-contained component that handles all drag interactions.
	 * blindDragY: 0 = fully closed (visible), -105 = fully open (off-screen).
	 * During drag, CSS transition is disabled for instant response.
	 * On release, snaps to open or closed with a spring transition.
	 *
	 * CSS custom properties --frame-width and --inner-radius are inherited
	 * from the parent .window-container.
	 */
	import { clamp } from "$lib/shared/utils";

	interface Props {
		open: boolean;
		transitioning: boolean;
		onToggle: (open: boolean) => void;
	}

	let { open, transitioning, onToggle }: Props = $props();

	// --- Drag state (internal) ---
	let isDragging = $state(false);
	let blindDragY = $state(0);
	let dragStartBlindY = 0;
	let dragStartPointerY = 0;
	let blindContainerHeight = 0;
	const SNAP_THRESHOLD = 0.3;

	// --- Bind to the clip element for height measurement ---
	let clipEl: HTMLDivElement | undefined = $state(undefined);

	// Sync blindDragY with open prop when not dragging
	$effect(() => {
		if (!isDragging) {
			blindDragY = open ? -105 : 0;
		}
	});

	const blindTransform = $derived(
		`translateY(${blindDragY.toFixed(1)}%)`
	);

	const blindTransition = $derived(
		isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.22, 0.68, 0, 1.05)'
	);

	// --- Drag handlers ---

	function getBlindHeight(): number {
		return clipEl?.offsetHeight ?? 1;
	}

	function startBlindDrag(pointerY: number) {
		if (transitioning) return;
		blindContainerHeight = getBlindHeight();
		isDragging = true;
		dragStartBlindY = blindDragY;
		dragStartPointerY = pointerY;
	}

	function moveBlindDrag(pointerY: number) {
		if (!isDragging) return;
		const deltaPixels = pointerY - dragStartPointerY;
		const deltaPct = (deltaPixels / blindContainerHeight) * 100;
		blindDragY = clamp(dragStartBlindY + deltaPct, -105, 0);
	}

	function endBlindDrag() {
		if (!isDragging) return;
		isDragging = false;
		const totalTravel = 105;
		const distanceTraveled = Math.abs(blindDragY - dragStartBlindY);
		const travelRatio = distanceTraveled / totalTravel;
		if (travelRatio > SNAP_THRESHOLD) {
			onToggle(blindDragY < dragStartBlindY);
		}
		// If not past threshold, $effect syncs blindDragY back
	}

	// --- Pointer event handlers (self-contained) ---

	function onPointerDown(e: PointerEvent) {
		startBlindDrag(e.clientY);
		// Capture so we receive move/up even outside the element
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		moveBlindDrag(e.clientY);
	}

	function onPointerUp() {
		endBlindDrag();
	}

	// --- Handle discoverability (plays once per session) ---
	let hasAnimated = $state(false);

	function onHandleAnimationEnd() {
		hasAnimated = true;
	}
</script>

<div class="blind-clip" bind:this={clipEl}>
	<div
		class="blind-overlay"
		class:discoverable={!open && !hasAnimated}
		onanimationend={onHandleAnimationEnd}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				onToggle(!open);
			}
		}}
		role="slider"
		tabindex={0}
		aria-label="Window blind — drag to open or close"
		aria-valuenow={Math.round(Math.abs(blindDragY))}
		aria-valuemin={0}
		aria-valuemax={105}
		style:transform={blindTransform}
		style:transition={blindTransition}
		style:pointer-events={open ? 'none' : 'auto'}
	>
		<div class="blind-slats"></div>
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
		background: rgba(240, 238, 235, 0.95);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		padding: 0;
		pointer-events: auto;
		touch-action: none;
		/* transform, transition, pointer-events set via inline style for drag support */
	}

	.blind-slats {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			180deg,
			rgba(230, 228, 225, 0.9) 0px,
			rgba(230, 228, 225, 0.9) 6px,
			rgba(210, 208, 205, 0.7) 6px,
			rgba(210, 208, 205, 0.7) 8px
		);
		box-shadow: inset 0 -20px 30px rgba(0, 0, 0, 0.1);
	}

	.blind-overlay::after {
		content: "";
		position: absolute;
		bottom: 8%;
		left: 30%;
		right: 30%;
		height: 14px;
		background:
			repeating-linear-gradient(
				180deg,
				transparent 0px,
				transparent 3px,
				rgba(0, 0, 0, 0.15) 3px,
				rgba(0, 0, 0, 0.15) 4px,
				transparent 4px,
				transparent 5px
			),
			linear-gradient(180deg, var(--sw-silver) 0%, #908880 100%);
		border-radius: 6px;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
	}

	/* --- Blind handle discoverability pulse (once per session) --- */

	@keyframes handle-breathe {
		0%,
		100% {
			transform: translateY(0);
			opacity: 0.9;
		}
		50% {
			transform: translateY(-3px);
			opacity: 1;
		}
	}

	.blind-overlay.discoverable::after {
		animation: handle-breathe 1s ease-in-out 3;
	}
</style>
