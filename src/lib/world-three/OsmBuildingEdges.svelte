<script lang="ts">
	/**
	 * OsmBuildingEdges — building FOOTPRINTS glowing as two-layer neon
	 * lines tracing the ground perimeter of each building.
	 *
	 * Thin wrapper around NeonLineLayer with a buildSegments closure that
	 * extracts the bottom-perimeter edges from OSM polygon footprints.
	 * Per-building brightness comes from a deterministic hash of the
	 * polygon's first vertex (so the same buildings glow brightly across
	 * location revisits — no flicker as you orbit).
	 *
	 * Originally rendered the full cube wireframe (top + bottom + verticals).
	 * Changed to footprint-only at user request: the cube cage read as
	 * "scaffolding"; the bottom-ring-only reads as "city light traced on
	 * the ground." 3× cheaper geometry.
	 */
	import NeonLineLayer, { type NeonSegments } from './NeonLineLayer.svelte';
	import type { LocationId } from '$lib/types';
	import { EARTH_RADIUS_M } from './state.svelte';

	let { location }: { location: LocationId } = $props();

	interface BuildingFeature {
		type: 'Feature';
		geometry: { type: 'Polygon'; coordinates: [number, number][][] };
		properties: { height?: number };
	}

	// Deterministic per-building brightness — quadratic curve biased toward
	// "mostly dim, a few bright" matching real-city light distribution.
	function hashBrightness(lon: number, lat: number): number {
		const h = Math.sin(lon * 12.9898 + lat * 78.233) * 43758.5453;
		const seed = h - Math.floor(h);
		return 0.20 + seed * seed * 0.80;
	}

	function buildFootprintEdges(
		features: BuildingFeature[],
		lat0: number,
		lon0: number,
	): NeonSegments | null {
		const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
		const R = EARTH_RADIUS_M;

		// Count vertices across ALL rings (outer + hole rings).
		// GeoJSON polygons model courtyards as inner rings in
		// coordinates[1..n]; previously only coordinates[0] was read,
		// so courtyards rendered as solid glowing footprints.
		let totalVerts = 0;
		for (const f of features) {
			for (const ring of f.geometry.coordinates) {
				if (!ring || ring.length < 4) continue;
				totalVerts += 2 * (ring.length - 1);
			}
		}
		if (totalVerts === 0) return null;

		const positions = new Float32Array(totalVerts * 3);
		const colors    = new Float32Array(totalVerts * 3);
		let off = 0;

		for (const f of features) {
			const rings = f.geometry.coordinates;
			for (let r = 0; r < rings.length; r++) {
				const ring = rings[r];
				if (!ring || ring.length < 4) continue;
				// Inner rings (courtyards) at 70% brightness — subtle
				// distinction from the outer footprint perimeter.
				const brightness = hashBrightness(ring[0][0], ring[0][1]) * (r === 0 ? 1 : 0.7);

				const n = ring.length - 1;
				const xs = new Float32Array(n);
				const zs = new Float32Array(n);
				for (let i = 0; i < n; i++) {
					const [lon, lat] = ring[i];
					xs[i] = ((lon - lon0) * Math.PI) / 180 * cosLat0 * R;
					zs[i] = -((lat - lat0) * Math.PI) / 180 * R;
				}

				for (let i = 0; i < n; i++) {
					const j = (i + 1) % n;
					positions[off + 0] = xs[i]; positions[off + 1] = 0; positions[off + 2] = zs[i];
					colors[off + 0] = brightness; colors[off + 1] = brightness; colors[off + 2] = brightness;
					off += 3;
					positions[off + 0] = xs[j]; positions[off + 1] = 0; positions[off + 2] = zs[j];
					colors[off + 0] = brightness; colors[off + 1] = brightness; colors[off + 2] = brightness;
					off += 3;
				}
			}
		}

		return { positions, colors };
	}
</script>

<NeonLineLayer
	{location}
	endpoint="/api/buildings"
	coreColor={0xffcc88}
	coreWidth={1.6}
	haloColor={0xff8844}
	haloWidth={5.0}
	haloOpacityMul={0.62}
	intensityMul={1.9}
	depthFade={12000}
	viirsModulate
	buildSegments={buildFootprintEdges}
/>
