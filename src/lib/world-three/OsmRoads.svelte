<script lang="ts">
	/**
	 * OsmRoads — fetches real OSM road LineStrings from /api/roads/:city
	 * and renders them as a single `LineSegments` anchored at the city's
	 * lat/lon on the WGS84 ellipsoid.
	 *
	 * Per-class colour: motorway = bright sodium, primary = amber,
	 * secondary = warm white, tertiary = dim amber, residential = grey.
	 * Tinting baked into per-vertex colors so one material + one draw call
	 * paints the whole city skeleton.
	 *
	 * Coordinate frame: same ENU tangent-plane construction as
	 * OsmBuildings.svelte (verified math, three-globe convention).
	 *
	 * Visibility: roads sit on the ellipsoid surface at z=0 (no
	 * extrusion). At cruise altitude they're sub-pixel — visible from
	 * "City Approach" altitude and below.
	 */
	import { T } from '@threlte/core';
	import {
		BufferGeometry,
		BufferAttribute,
		Matrix4,
		Vector3,
		LineBasicMaterial,
		type Group as ThreeGroup,
	} from 'three';
	import { LOCATION_MAP } from '$content/locations';
	import type { LocationId } from '$lib/types';
	import { EARTH_RADIUS_M, geoToCartesian } from './state.svelte';

	let { location }: { location: LocationId } = $props();

	interface RoadFeature {
		type: 'Feature';
		geometry: { type: 'LineString'; coordinates: [number, number][] };
		properties: { class?: string };
	}
	interface RoadsResponse {
		type: 'FeatureCollection';
		features: RoadFeature[];
	}

	// Per-class colour (linear sRGB — Three.js converts at output).
	const CLASS_COLOUR: Record<string, [number, number, number]> = {
		motorway:    [1.00, 0.74, 0.30], // sodium amber
		trunk:       [1.00, 0.74, 0.30],
		primary:     [1.00, 0.62, 0.25],
		secondary:   [0.95, 0.88, 0.72], // warm white
		tertiary:    [0.78, 0.58, 0.36],
		residential: [0.48, 0.45, 0.40], // dim grey-warm
	};
	const DEFAULT_COLOUR: [number, number, number] = [0.48, 0.45, 0.40];

	// $state.raw — Three.js objects don't need Proxy wrapping. Only the
	// reassignment-triggered template re-mount matters here.
	let geometry: BufferGeometry | null = $state.raw(null);
	let anchorMatrix: Matrix4 | null = $state.raw(null);
	let pendingDispose: BufferGeometry | null = null;
	let group: ThreeGroup | undefined = $state.raw();

	const material = new LineBasicMaterial({
		vertexColors: true,
		linewidth: 1, // WebGL ignores >1 but spec-required
	});

	// Release material + in-flight geometry on unmount.
	$effect(() => () => {
		material.dispose();
		pendingDispose?.dispose();
		pendingDispose = null;
	});

	// Re-apply the anchor matrix whenever it changes (location switch) —
	// `oncreate` would only fire once at mount, leaving stale transforms
	// when the user switches cities.
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
				const built = buildLines(data.features, loc.lat, loc.lon);
				if (built) {
					pendingDispose = built.geom;
					geometry = built.geom;
					anchorMatrix = built.matrix;
				}
			})
			.catch((e) => { if (e.name !== 'AbortError') console.warn('[OsmRoads]', e); });
		return () => ctrl.abort();
	});

	function buildLines(
		features: RoadFeature[],
		lat0: number,
		lon0: number,
	): { geom: BufferGeometry; matrix: Matrix4 } | null {
		const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
		const R = EARTH_RADIUS_M;

		// Estimate total vertex count. Each LineString of N points becomes
		// 2*(N-1) line-segment endpoints (each segment is 2 verts).
		let segVertCount = 0;
		for (const f of features) {
			const ring = f.geometry.coordinates;
			if (!ring || ring.length < 2) continue;
			segVertCount += 2 * (ring.length - 1);
		}
		if (segVertCount === 0) return null;

		const positions = new Float32Array(segVertCount * 3);
		const colors    = new Float32Array(segVertCount * 3);
		let off = 0;

		for (const f of features) {
			const ring = f.geometry.coordinates;
			if (!ring || ring.length < 2) continue;
			const cls = f.properties.class ?? 'residential';
			const c = CLASS_COLOUR[cls] ?? DEFAULT_COLOUR;

			// Project each vertex to local ENU (east, sea-level, north).
			// LineSegments expects pairs: (v0,v1), (v1,v2), ...
			for (let i = 0; i < ring.length - 1; i++) {
				const [lonA, latA] = ring[i];
				const [lonB, latB] = ring[i + 1];
				const ex0 = ((lonA - lon0) * Math.PI) / 180 * cosLat0 * R;
				const nz0 = ((latA - lat0) * Math.PI) / 180 * R;
				const ex1 = ((lonB - lon0) * Math.PI) / 180 * cosLat0 * R;
				const nz1 = ((latB - lat0) * Math.PI) / 180 * R;
				// 2D shape coords: (east, north) → after the anchor matrix
				// composes with our rotateX(-π/2) idiom from buildings,
				// we want local (east, 0, -north). But roads don't extrude
				// so we just place at z=local-up=0 in a frame where the
				// basis third column is -north_world.
				// To match the OsmBuildings anchor convention (which uses
				// makeBasis(east, up, -north)), shape-local Z must equal
				// -north_offset so it composes correctly.
				positions[off + 0] = ex0;
				positions[off + 1] = 0;
				positions[off + 2] = -nz0;
				colors[off + 0] = c[0]; colors[off + 1] = c[1]; colors[off + 2] = c[2];
				off += 3;
				positions[off + 0] = ex1;
				positions[off + 1] = 0;
				positions[off + 2] = -nz1;
				colors[off + 0] = c[0]; colors[off + 1] = c[1]; colors[off + 2] = c[2];
				off += 3;
			}
		}

		const geom = new BufferGeometry();
		geom.setAttribute('position', new BufferAttribute(positions, 3));
		geom.setAttribute('color',    new BufferAttribute(colors, 3));
		geom.computeBoundingSphere();

		// Anchor frame — same construction as OsmBuildings.
		const [x, y, z] = geoToCartesian(lat0, lon0, 0);
		const up    = new Vector3(x, y, z).normalize();
		const east  = new Vector3().crossVectors(new Vector3(0, 1, 0), up).normalize();
		const north = new Vector3().crossVectors(up, east).normalize();
		const matrix = new Matrix4().makeBasis(east, up, north.clone().negate());
		matrix.setPosition(x, y, z);
		return { geom, matrix };
	}

</script>

{#if geometry && anchorMatrix}
	<T.Group bind:ref={group}>
		<T.LineSegments {geometry} {material} />
	</T.Group>
{/if}
