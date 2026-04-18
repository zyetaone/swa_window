<script lang="ts">
/**
 * CloudCanvasLayer — MapLibre canvas source for horizon/distant clouds.
 *
 * Renders cloud sprites onto a hidden <canvas>, then projects it onto
 * the globe at geographic coordinates around the current location.
 * MapLibre handles perspective + depth sorting with terrain natively.
 *
 * This is the SSOT for distant/horizon clouds. CSS3DClouds handles
 * foreground/midground clouds as CSS overlay (no depth sorting needed).
 *
 * Architecture:
 * - Hidden <canvas> (1024x512) — cloud sprites drawn with 2D context
 * - MapLibre `canvas` source with geographic bounds around active location
 * - Raster layer with opacity driven by nightFactor + weather
 * - Canvas redraws at 2Hz (clouds move slowly at distance)
 */

import { RasterLayer } from 'svelte-maplibre-gl';
import type maplibregl from 'maplibre-gl';

let {
	mapRef,
	lat = 25.2,
	lon = 55.3,
	nightFactor = 0,
	density = 0.75,
	heading = 0,
	weather = 'clear',
}: {
	mapRef?: maplibregl.Map;
	lat?: number;
	lon?: number;
	nightFactor?: number;
	density?: number;
	heading?: number;
	weather?: string;
} = $props();

// Canvas dimensions — lower res is fine, MapLibre upscales
const CW = 1024;
const CH = 512;

let canvasEl: HTMLCanvasElement | undefined = $state();
let cloudImg: HTMLImageElement | undefined = $state();
let sourceAdded = $state(false);

// Load cloud sprite image
$effect(() => {
	const img = new Image();
	img.src = '/cloud.png';
	img.onload = () => { cloudImg = img; };
});

// Cloud positions — regenerate when location changes
interface CanvasCloud {
	x: number;  // 0-1 normalized on canvas
	y: number;
	size: number;
	opacity: number;
	rotation: number;
	driftX: number; // per-second drift
}

let clouds = $state<CanvasCloud[]>([]);

$effect(() => {
	// Regenerate cloud layout when location or weather changes
	void lat; void lon; void weather; void heading;
	const isStorm = weather === 'storm' || weather === 'rain';
	const count = Math.round(density * (isStorm ? 30 : 20)) + 5;
	// Heading influences drift direction
	const headRad = heading * Math.PI / 180;
	clouds = Array.from({ length: count }, () => ({
		x: Math.random(),
		y: Math.random() * 0.7 + 0.15,
		size: 0.08 + Math.random() * (isStorm ? 0.2 : 0.15),
		opacity: (isStorm ? 0.4 : 0.25) + Math.random() * 0.45,
		rotation: Math.random() * Math.PI * 2,
		driftX: Math.cos(headRad) * 0.001 + (Math.random() - 0.5) * 0.001,
	}));
});

// Draw clouds onto canvas at 2Hz
$effect(() => {
	if (!canvasEl || !cloudImg) return;
	const ctx = canvasEl.getContext('2d');
	if (!ctx) return;

	const interval = setInterval(() => {
		ctx.clearRect(0, 0, CW, CH);

		// Night tint
		if (nightFactor > 0.3) {
			ctx.fillStyle = `rgba(10, 15, 30, ${nightFactor * 0.3})`;
			ctx.fillRect(0, 0, CW, CH);
		}

		for (const c of clouds) {
			// Drift
			c.x = (c.x + c.driftX + 1) % 1;

			const cx = c.x * CW;
			const cy = c.y * CH;
			const sz = c.size * CW;

			ctx.save();
			ctx.globalAlpha = c.opacity * density;
			ctx.translate(cx, cy);
			ctx.rotate(c.rotation);
			ctx.drawImage(cloudImg!, -sz / 2, -sz / 2, sz, sz);
			ctx.restore();
		}
	}, 500); // 2Hz redraw

	return () => clearInterval(interval);
});

// Add canvas source to MapLibre when both canvas and map are ready
$effect(() => {
	if (!mapRef || !canvasEl) return;
	const m = mapRef;

	const addSource = () => {
		if (sourceAdded) return;
		try {
			// Geographic extent: ~2 degrees around current location
			const span = 1.5;
			m.addSource('cloud-canvas', {
				type: 'canvas',
				canvas: canvasEl!,
				coordinates: [
					[lon - span, lat + span * 0.5],  // top-left
					[lon + span, lat + span * 0.5],  // top-right
					[lon + span, lat - span * 0.5],  // bottom-right
					[lon - span, lat - span * 0.5],  // bottom-left
				],
				animate: true,
			});
			sourceAdded = true;
		} catch (e) {
			console.warn('[CloudCanvas] Failed to add source:', e);
		}
	};

	if (m.isStyleLoaded()) addSource();
	else m.once('load', addSource);

	return () => {
		if (sourceAdded && m.getSource('cloud-canvas')) {
			try {
				if (m.getLayer('cloud-canvas-layer')) m.removeLayer('cloud-canvas-layer');
				m.removeSource('cloud-canvas');
			} catch {}
			sourceAdded = false;
		}
	};
});
</script>

<!-- Hidden canvas — cloud sprites are drawn here, MapLibre reads it as a source -->
<canvas
	bind:this={canvasEl}
	width={CW}
	height={CH}
	style="display:none"
></canvas>

<!-- Raster layer renders the canvas source on the globe -->
{#if sourceAdded}
	<RasterLayer
		id="cloud-canvas-layer"
		source="cloud-canvas"
		paint={{
			'raster-opacity': Math.min(0.7, density * 0.8),
			'raster-fade-duration': 0,
		}}
	/>
{/if}
