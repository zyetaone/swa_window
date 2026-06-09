<script lang="ts">
	/**
	 * OsmRoads — road LineStrings traced as glowing two-layer neon lines.
	 *
	 * Thin wrapper around NeonLineLayer with a buildSegments closure that
	 * converts OSM LineString features into LineSegments endpoint pairs +
	 * per-class colour. Cool warm-white palette so roads register as a
	 * distinct lighting type from the warm sodium building footprints.
	 *
	 * Per-class color contributes the urban hierarchy: motorway / trunk
	 * brightest (mercury-vapour street-lamp feel), residential streets
	 * quietest. Vertex-color values can exceed 1.0 to brighten major
	 * arteries beyond the material's base tint.
	 */
	import NeonLineLayer, { type NeonSegments } from './NeonLineLayer.svelte';
	import type { LocationId } from '$lib/types';
	import { EARTH_RADIUS_M } from './state.svelte';

	let { location }: { location: LocationId } = $props();

	interface RoadFeature {
		type: 'Feature';
		geometry: { type: 'LineString'; coordinates: [number, number][] };
		properties: { class?: string };
	}

	// Class colours pulled below 1.0 across the board so they no longer blow
	// out to hot white discs under the bloom pass — the brightest arteries
	// (motorway/trunk) now sit at ~0.95 instead of 1.45. Urban hierarchy is
	// preserved by the relative ratios, just at a calmer overall level.
	const CLASS_COLOUR: Record<string, [number, number, number]> = {
		motorway:    [0.88, 0.94, 1.00],
		trunk:       [0.88, 0.94, 1.00],
		primary:     [0.74, 0.82, 0.92],
		secondary:   [0.60, 0.68, 0.80],
		tertiary:    [0.46, 0.54, 0.66],
		residential: [0.32, 0.38, 0.48],
	};
	const DEFAULT_COLOUR: [number, number, number] = [0.32, 0.38, 0.48];

	function buildRoadLines(
		features: RoadFeature[],
		lat0: number,
		lon0: number,
	): NeonSegments | null {
		const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
		const R = EARTH_RADIUS_M;

		let totalVerts = 0;
		for (const f of features) {
			const ring = f.geometry.coordinates;
			if (!ring || ring.length < 2) continue;
			totalVerts += 2 * (ring.length - 1);
		}
		if (totalVerts === 0) return null;

		const positions = new Float32Array(totalVerts * 3);
		const colors    = new Float32Array(totalVerts * 3);
		let off = 0;

		for (const f of features) {
			const ring = f.geometry.coordinates;
			if (!ring || ring.length < 2) continue;
			const cls = f.properties.class ?? 'residential';
			const c = CLASS_COLOUR[cls] ?? DEFAULT_COLOUR;

			for (let i = 0; i < ring.length - 1; i++) {
				const [lonA, latA] = ring[i];
				const [lonB, latB] = ring[i + 1];
				const ex0 = ((lonA - lon0) * Math.PI) / 180 * cosLat0 * R;
				const nz0 = ((latA - lat0) * Math.PI) / 180 * R;
				const ex1 = ((lonB - lon0) * Math.PI) / 180 * cosLat0 * R;
				const nz1 = ((latB - lat0) * Math.PI) / 180 * R;

				// Lift roads 0.5 m above the ellipsoid so they don't z-fight
				// with terrain. ENU local frame: y is up.
				positions[off + 0] = ex0;  positions[off + 1] = 0.5;  positions[off + 2] = -nz0;
				colors[off + 0] = c[0];    colors[off + 1] = c[1];    colors[off + 2] = c[2];
				off += 3;
				positions[off + 0] = ex1;  positions[off + 1] = 0.5;  positions[off + 2] = -nz1;
				colors[off + 0] = c[0];    colors[off + 1] = c[1];    colors[off + 2] = c[2];
				off += 3;
			}
		}

		return { positions, colors };
	}
</script>

<!--
	Dashed/dotted roads: 70 m dash + 55 m gap reads as a string of streetlight
	dots from cruise altitude rather than a continuous painted line — softer,
	more "city traced in light" than "road map". Sizes are in ENU world metres
	(see buildRoadLines). Both core + halo share the dash phase so the glow
	pulses with each dot.
-->
<NeonLineLayer
	{location}
	endpoint="/api/roads"
	coreColor={0xeaf4ff}
	coreWidth={1.5}
	haloColor={0x8ab0d8}
	haloWidth={4.5}
	haloOpacityMul={0.45}
	intensityMul={0.6}
	dashed
	dashSize={70}
	gapSize={55}
	dashFlow={20}
	depthFade={12000}
	buildSegments={buildRoadLines}
/>
