<script lang="ts">
	/**
	 * TreeLayer - Procedural CSS tree overlay
	 *
	 * Z-order: 4 (above clouds/weather, below frost/wing)
	 * Uses seeded pseudo-random placement based on locationId for stable tree positions.
	 */

	import { LOCATION_MAP } from "$lib/locations";
	import type { LocationId } from "$lib/types";

	interface Props {
		locationId: LocationId;
		nightFactor: number;
		cloudDensity: number;
		showTrees: boolean;
	}

	let { locationId, nightFactor, cloudDensity, showTrees }: Props = $props();

	function hashString(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return Math.abs(hash);
	}

	function seededRandom(seed: number, index: number): number {
		const x = Math.sin(seed + index * 9999) * 10000;
		return x - Math.floor(x);
	}

	interface Tree {
		x: number;
		y: number;
		size: number;
		delay: number;
		duration: number;
	}

	const trees = $derived.by(() => {
		const location = LOCATION_MAP.get(locationId);
		const hasTrees = location?.hasBuildings ?? false;
		const baseCount = hasTrees ? 30 : 8;
		const count = Math.min(40, Math.max(20, baseCount + Math.floor(cloudDensity * 20)));
		const seed = hashString(locationId);
		const result: Tree[] = [];

		for (let i = 0; i < count; i++) {
			const randX = seededRandom(seed, i * 3);
			const randY = seededRandom(seed, i * 3 + 1);
			const randSize = seededRandom(seed, i * 3 + 2);
			const randDelay = seededRandom(seed, i * 7);
			const randDuration = 3 + seededRandom(seed, i * 11) * 2;

			result.push({
				x: randX * 90 + 5,
				y: randY * 85 + 10,
				size: 4 + randSize * 8,
				delay: randDelay * 5,
				duration: randDuration,
			});
		}
		return result;
	});

	const treeBrightness = $derived.by(() => {
		return Math.max(0.1, 1 - nightFactor * 1.2);
	});

	const visible = $derived(showTrees && cloudDensity > 0.1);
</script>

{#if visible}
	<div class="tree-layer" style:z-index={4} style:opacity={cloudDensity}>
		{#each trees as tree}
			<div
				class="tree"
				style:left="{tree.x}%"
				style:top="{tree.y}%"
				style:width="{tree.size}px"
				style:height="{tree.size * 1.2}px"
				style:animation-delay="{tree.delay}s"
				style:animation-duration="{tree.duration}s"
				style:filter="brightness({treeBrightness.toFixed(2)})"
			></div>
		{/each}
	</div>
{/if}

<style>
	.tree-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.tree {
		position: absolute;
		border-radius: 50%;
		background: radial-gradient(circle, #1a4d1a 0%, #0d2b0d 100%);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
		transform-origin: center bottom;
		animation: sway ease-in-out infinite alternate;
	}

	@keyframes sway {
		from {
			transform: rotate(-2deg);
		}
		to {
			transform: rotate(2deg);
		}
	}
</style>
