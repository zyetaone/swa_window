<script lang="ts">
	/**
	 * OsmRoads — road LineStrings traced as glowing two-layer neon lines.
	 *
	 * Same recipe as OsmBuildingEdges: Line2 + LineMaterial × 2 (bright
	 * sharp core + wider soft halo, both additive), ENU-anchored via the
	 * shared `enuAnchorMatrix` helper, opacity driven by nightFactor in
	 * a useTask with an altitude gate.
	 *
	 * Differences vs OsmBuildingEdges:
	 *   - Per-class color (motorway/primary/secondary/tertiary/residential)
	 *     baked into per-vertex colours so the major arteries glow brighter
	 *     than residential streets — reads as the actual urban hierarchy.
	 *   - Slightly cooler/whiter palette than the warm building footprints;
	 *     the contrast helps roads vs buildings register as different layers.
	 *   - Thinner core (1.2 px) — roads should read as lines, buildings
	 *     should read as filled-perimeter masses.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import {
		Matrix4,
		Vector2,
		AdditiveBlending,
		type Group as ThreeGroup,
	} from 'three';
	import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
	import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
	import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
	import { LOCATION_MAP } from '$content/locations';
	import type { LocationId } from '$lib/types';
	import { EARTH_RADIUS_M } from './state.svelte';
	import { enuAnchorMatrix } from './enu';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	let { 
		location,
		ambientColor,
		ambientIntensity = 1,
	}: { 
		location: LocationId;
		ambientColor?: import('three').Color;
		ambientIntensity?: number;
	} = $props();

	const model = useAeroWindow();
	const nightFactor = $derived(model.nightFactor);
	const ctx = useThrelte();

	interface RoadFeature {
		type: 'Feature';
		geometry: { type: 'LineString'; coordinates: [number, number][] };
		properties: { class?: string };
	}
	interface RoadsResponse {
		type: 'FeatureCollection';
		features: RoadFeature[];
	}

	let geometry = $state.raw<LineSegmentsGeometry | null>(null);
	let anchorMatrix = $state.raw<Matrix4 | null>(null);
	let pendingDispose: LineSegmentsGeometry | null = null;
	let group: ThreeGroup | undefined = $state.raw();

	// Cool warm-white for roads — deliberately less amber than the
	// buildings so the two layers register as different lighting kinds
	// (street lamps mid-blue vs. building sodium amber). Slightly THICKER
	// + brighter halo than the first pass so roads aren't overpowered by
	// the warm building density.
	const coreMaterial = new LineMaterial({
		color: 0xeaf4ff,
		linewidth: 2.0,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		worldUnits: false,
		vertexColors: true,
	});
	const haloMaterial = new LineMaterial({
		color: 0x8ab0d8,
		linewidth: 5.5,
		transparent: true,
		opacity: 0,
		blending: AdditiveBlending,
		depthWrite: false,
		worldUnits: false,
		vertexColors: true,
	});

	const _scratch = new Vector2();

	// Altitude gate softened to 25-60 kft so cruise frames see roads.
	useTask(() => {
		const camAlt = model.flight.camAlt;
		const altGate = camAlt <= 25000
			? 1
			: Math.max(0, 1 - (camAlt - 25000) / 35000);
		let intensity = Math.max(0, nightFactor - 0.15) * 1.1 * altGate;

		// Light ambient harmony from the shared ThreeOverlay tint system
		// (same pattern as Clouds). Makes roads respond to the overall sky mood.
		const ai = ambientIntensity ?? 1;
		intensity *= ai;

		coreMaterial.opacity = intensity;
		haloMaterial.opacity = intensity * 0.55;

		if (ambientColor) {
			// Gentle tint so roads participate in dawn/dusk/neon mood shifts
			coreMaterial.color.set(
				ambientColor.r * 0.95 + 0.05,
				ambientColor.g * 0.95 + 0.05,
				ambientColor.b * 0.95 + 0.05
			);
		}

		const size = ctx.renderer.getSize(_scratch);
		coreMaterial.resolution.set(size.x, size.y);
		haloMaterial.resolution.set(size.x, size.y);
	});

	$effect(() => () => {
		coreMaterial.dispose();
		haloMaterial.dispose();
		pendingDispose?.dispose();
		pendingDispose = null;
	});

	$effect(() => {
		if (!group || !anchorMatrix) return;
		group.matrixAutoUpdate = false;
		group.matrix.copy(anchorMatrix);
	});

	$effect(() => {
		const loc = LOCATION_MAP.get(location);
		if (!loc) { geometry = null; return; }
		pendingDispose?.dispose();
		pendingDispose = null;
		geometry = null;
		const ctrl = new AbortController();
		fetch(`/api/roads/${location}`, { signal: ctrl.signal })
			.then((r) => r.json() as Promise<RoadsResponse>)
			.then((data) => {
				if (!data.features?.length) return;
				const built = buildRoadLines(data.features, loc.lat, loc.lon);
				if (built) {
					pendingDispose = built.geom;
					geometry = built.geom;
					anchorMatrix = built.matrix;
				}
			})
			.catch((e) => { if (e.name !== 'AbortError') console.warn('[OsmRoads]', e); });
		return () => ctrl.abort();
	});

	// Per-class warm-white → cool-grey ramp. Vertex colors multiply with
	// the material's base color; values can exceed 1.0 to brighten major
	// arteries beyond the base tint (renderer clamps in fragment shader).
	// Motorways punch as 1.3× brightness so they read above the building
	// dot density; residential streets stay quiet for hierarchy.
	const CLASS_COLOUR: Record<string, [number, number, number]> = {
		motorway:    [1.30, 1.38, 1.45],
		trunk:       [1.30, 1.38, 1.45],
		primary:     [1.10, 1.20, 1.32],
		secondary:   [0.90, 1.00, 1.12],
		tertiary:    [0.70, 0.80, 0.92],
		residential: [0.48, 0.55, 0.65],
	};
	const DEFAULT_COLOUR: [number, number, number] = [0.48, 0.55, 0.65];

	function buildRoadLines(
		features: RoadFeature[],
		lat0: number,
		lon0: number,
	): { geom: LineSegmentsGeometry; matrix: Matrix4 } | null {
		const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
		const R = EARTH_RADIUS_M;

		// Count line segments — each LineString of N points contributes
		// 2(N-1) endpoint vertices (LineSegments expects pairs).
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

		const geom = new LineSegmentsGeometry();
		geom.setPositions(positions);
		geom.setColors(colors);

		return { geom, matrix: enuAnchorMatrix(lat0, lon0, 0) };
	}

	const haloLine = new LineSegments2();
	haloLine.material = haloMaterial;
	const coreLine = new LineSegments2();
	coreLine.material = coreMaterial;

	$effect(() => {
		if (!geometry) return;
		haloLine.geometry = geometry;
		coreLine.geometry = geometry;
	});
</script>

{#if geometry && anchorMatrix}
	<T.Group bind:ref={group}>
		<T is={haloLine} />
		<T is={coreLine} />
	</T.Group>
{/if}
