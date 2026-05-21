<script lang="ts">
	/**
	 * VIIRS grid — procedural city-block CSS overlay.
	 *
	 * Per user direction "update css to be grid blocks y and dynamic. layered
	 * on the map as per nasa viirs."
	 *
	 * The Cesium VIIRS imagery layer gives us broad amber wash where cities
	 * are. The shader's per-pixel palette gives variance. But neither carries
	 * the *block-structure* feel of real city night views: rows of lit
	 * buildings stepping up in intensity, gaps between districts, the eye
	 * reads a GRID.
	 *
	 * This effect paints a deterministic grid of CSS divs above the Cesium
	 * canvas. Each cell's height + intensity is hashed from (cellX, cellY,
	 * locationLat, locationLon), so the same place gives the same pattern
	 * every visit, but different places give different patterns. Multiplied
	 * by location.scene.nightLightDensity (0 over ocean → no blocks, 0.95
	 * over Hyderabad → full bank).
	 *
	 * Cheap on Pi 5: ~16x12 = 192 DOM divs, no per-frame mutation, pure CSS
	 * + transform. Re-rolls only on location change.
	 */
	import { untrack } from 'svelte';
	import type { EffectProps } from '$lib/scene/types';
	import { Z } from '$lib/scene/layers';

	let { model }: EffectProps = $props();

	const GRID_X = 22;
	const GRID_Y = 14;

	const nightFactor = $derived(model.nightFactor);
	const lightScale = $derived(model.nightLightScale);
	const density = $derived(model.currentLocation.scene.nightLightDensity);
	const lat = $derived(model.flight.lat);
	const lon = $derived(model.flight.lon);

	// Layer opacity — invisible at day, peak at deep night, modulated by the
	// operator's light-intensity slider AND by location's VIIRS density.
	const layerOpacity = $derived(
		Math.min(0.9, nightFactor * lightScale * density * 0.85),
	);

	interface Block {
		cx: number;
		cy: number;
		x: number;     // % screen
		y: number;     // % screen
		w: number;     // % screen
		h: number;     // % screen — Y-dynamic per cell intensity
		intensity: number;  // 0..1
		color: string;
		shadow: string;
	}

	// Deterministic per-cell intensity. Seeded by cellX/Y + location so the
	// same place always paints the same grid (no jitter between renders) but
	// different places yield different patterns. Lifted from the same
	// hash-noise the shader uses for palette variance — keeps the look
	// family-coherent across the two systems.
	function intensityAt(cx: number, cy: number, lat: number, lon: number): number {
		const seed = Math.sin(
			cx * 12.9898
			+ cy * 78.233
			+ lat * 0.873
			+ lon * 0.531,
		) * 43758.5453;
		const r = seed - Math.floor(seed);
		// Heavier tail — most cells dim, a few cells very bright. This is
		// what makes city-block lighting read as a city rather than a uniform
		// wash. Power 2.2 collapses mids; the bright ~10% of cells get the
		// glow.
		return Math.pow(r, 2.2);
	}

	// 3-stop warm palette mirrors the shader (sodium → amber → warm-white).
	function paletteAt(intensity: number): { color: string; shadow: string } {
		// sodium  rgb(255, 153,  51) at 0.15
		// amber   rgb(255, 204, 102) at 0.5
		// warmW   rgb(255, 242, 217) at 0.9
		let r = 255, g = 153, b = 51;
		if (intensity > 0.5) {
			const t = Math.min(1, (intensity - 0.5) / 0.4);
			r = 255;
			g = Math.round(204 + (242 - 204) * t);
			b = Math.round(102 + (217 - 102) * t);
		} else {
			const t = Math.max(0, (intensity - 0.15) / 0.35);
			r = 255;
			g = Math.round(153 + (204 - 153) * t);
			b = Math.round(51 + (102 - 51) * t);
		}
		const color = `rgb(${r}, ${g}, ${b})`;
		const shadow = `0 0 ${(4 + intensity * 18).toFixed(1)}px rgba(${r}, ${g}, ${b}, ${(intensity * 0.65).toFixed(2)})`;
		return { color, shadow };
	}

	// Re-roll blocks when location changes (lat/lon shift large enough to
	// re-seed). Using $derived.by so the calculation is memoised and Svelte
	// only recomputes when an input actually changes.
	const blocks = $derived.by<Block[]>(() => {
		void lat;
		void lon;
		void density;

		if (density < 0.02) return [];  // no city → no blocks

		const out: Block[] = [];
		const cellW = 100 / GRID_X;
		const baseRowY = 40;  // screen-y % where the city horizon lives
		const rowSpan = 22;   // % vertical band the grid occupies

		return untrack(() => {
			for (let cy = 0; cy < GRID_Y; cy++) {
				for (let cx = 0; cx < GRID_X; cx++) {
					const raw = intensityAt(cx, cy, lat, lon);
					const intensity = raw * density;
					if (intensity < 0.1) continue;  // skip dim cells (most of them)

					const x = cx * cellW;
					const y = baseRowY + (cy / GRID_Y) * rowSpan;
					// Y-dynamic: block height scales with intensity. Brightest
					// cells render as tall stripes (~3.5% screen-y), dimmest
					// as nearly-invisible flecks (~0.6%).
					const h = 0.6 + intensity * 3.2;
					// Width jitter so blocks don't read as a perfectly
					// uniform grid — real city blocks are messy.
					const widthJitter = ((cx * 7 + cy * 13) % 5) * 0.08;
					const w = cellW * (0.55 + widthJitter);

					const { color, shadow } = paletteAt(intensity);
					out.push({ cx, cy, x, y, w, h, intensity, color, shadow });
				}
			}
			return out;
		});
	});
</script>

<div class="viirs-grid" style:opacity={layerOpacity} style:z-index={Z.viirsGrid} aria-hidden="true">
	{#each blocks as block (block.cx + '_' + block.cy)}
		<div
			class="viirs-block"
			style:left="{block.x}%"
			style:top="{block.y}%"
			style:width="{block.w}%"
			style:height="{block.h}%"
			style:background={block.color}
			style:box-shadow={block.shadow}
		></div>
	{/each}
</div>

<style>
	.viirs-grid {
		position: absolute;
		inset: 0;
		pointer-events: none;
		mix-blend-mode: screen;
		transition: opacity 1.5s ease;
		/* Same horizon-band mask as the cloud layer so the grid only paints
		   in the visible city zone — fades to transparent above and below.
		   Without this, blocks would leak into the sky and into the close
		   foreground where there's no city. */
		-webkit-mask-image: linear-gradient(
			to bottom,
			transparent 30%,
			rgba(0, 0, 0, 0.7) 38%,
			black 45%,
			black 60%,
			rgba(0, 0, 0, 0.4) 68%,
			transparent 75%
		);
		mask-image: linear-gradient(
			to bottom,
			transparent 30%,
			rgba(0, 0, 0, 0.7) 38%,
			black 45%,
			black 60%,
			rgba(0, 0, 0, 0.4) 68%,
			transparent 75%
		);
	}

	.viirs-block {
		position: absolute;
		border-radius: 1px;
		will-change: opacity;
	}

	@media (prefers-reduced-motion: reduce) {
		.viirs-grid { display: none; }
	}
</style>
