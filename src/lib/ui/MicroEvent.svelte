<script lang="ts">
	/**
	 * MicroEvent - Pure presentational layer for transient sky events.
	 *
	 * Renders shooting stars, birds, and contrails at the specified
	 * position with CSS-driven animation. Progress is derived internally.
	 *
	 * Z-order 3 (set by parent via inline style).
	 */

	interface MicroEventData {
		type: 'shooting-star' | 'bird' | 'contrail';
		elapsed: number;
		duration: number;
		x: number;
		y: number;
	}

	interface Props {
		event: MicroEventData | null;
	}

	let { event }: Props = $props();

	const progress = $derived(event ? event.elapsed / event.duration : 0);
</script>

{#if event}
	<div
		class="micro-event micro-event-{event.type}"
		style:z-index={3}
		style:left="{event.x}%"
		style:top="{event.y}%"
		style:--progress={progress}
	></div>
{/if}

<style>
	/* --- Micro-events --- */

	.micro-event {
		position: absolute;
		pointer-events: none;
	}

	.micro-event-shooting-star {
		width: 2px;
		height: 60px;
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.9) 0%,
			rgba(200, 220, 255, 0.5) 40%,
			transparent 100%
		);
		transform: rotate(-35deg);
		opacity: calc(1 - var(--progress));
		animation: shooting-star 1.5s linear forwards;
	}

	@keyframes shooting-star {
		from {
			transform: rotate(-35deg) translate(0, 0);
		}
		to {
			transform: rotate(-35deg) translate(120px, 200px);
		}
	}

	.micro-event-bird {
		width: 12px;
		height: 4px;
		background: rgba(20, 20, 20, 0.6);
		border-radius: 50%;
		opacity: calc(1 - var(--progress) * var(--progress));
		animation: bird-fly 8s linear forwards;
	}

	.micro-event-bird::before,
	.micro-event-bird::after {
		content: "";
		position: absolute;
		top: -2px;
		width: 8px;
		height: 3px;
		background: rgba(20, 20, 20, 0.5);
		border-radius: 50%;
		animation: bird-flap 0.3s ease-in-out infinite alternate;
	}

	.micro-event-bird::before {
		left: -6px;
		transform-origin: right center;
	}

	.micro-event-bird::after {
		right: -6px;
		transform-origin: left center;
	}

	@keyframes bird-fly {
		from {
			transform: translate(0, 0);
		}
		to {
			transform: translate(-200px, 30px);
		}
	}

	@keyframes bird-flap {
		from {
			transform: rotate(-15deg);
		}
		to {
			transform: rotate(15deg);
		}
	}

	.micro-event-contrail {
		width: 1px;
		height: 1px;
		opacity: calc(0.6 * (1 - var(--progress)));
	}

	.micro-event-contrail::after {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		width: calc(var(--progress) * 200px);
		height: 2px;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.4) 30%,
			rgba(255, 255, 255, 0.6) 100%
		);
		filter: blur(1px);
		transform: rotate(-5deg);
	}
</style>
