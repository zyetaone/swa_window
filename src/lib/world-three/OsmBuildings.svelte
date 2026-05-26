<script lang="ts">
	/**
	 * OsmBuildings — fetches real OSM building footprints from
	 * /api/buildings/:city and extrudes them as Three.js meshes anchored
	 * at the city's lat/lon on the WGS84 ellipsoid.
	 *
	 * Coordinate frame: each building's footprint is projected to a local
	 * ENU (East-North-Up) plane at the city centre, then the whole cluster
	 * is mounted with its +Y axis aligned to the surface normal at
	 * (lat0, lon0) — so buildings stand "up" radially out from the globe.
	 *
	 * This is the first piece of REAL geographic data in the Three.js
	 * stack — same GeoJSON the Cesium build consumes. Render visibility:
	 * at cruise altitude (10+ km) the cluster is sub-pixel. Drop the
	 * altitude slider below ~3 km to see the buildings stand up.
	 *
	 * Performance: all features are merged into a single BufferGeometry
	 * so the renderer issues one draw call regardless of footprint count.
	 */
	import { T } from '@threlte/core';
	import {
		Shape,
		ExtrudeGeometry,
		Matrix4,
		Vector3,
		MeshStandardMaterial,
		Color,
		BufferGeometry,
		BufferAttribute,
		type Group as ThreeGroup,
	} from 'three';
	import { LOCATION_MAP } from '$content/locations';
	import type { LocationId } from '$lib/types';
	import { EARTH_RADIUS_M, geoToCartesian } from './state.svelte';

	let { location }: { location: LocationId } = $props();

	interface BuildingFeature {
		type: 'Feature';
		geometry: { type: 'Polygon'; coordinates: [number, number][][] };
		properties: { height?: number };
	}
	interface BuildingsResponse {
		type: 'FeatureCollection';
		features: BuildingFeature[];
	}

	let geometry: BufferGeometry | null = $state(null);
	let anchorMatrix: Matrix4 | null = $state(null);
	// Non-reactive ref so disposal in $effect doesn't register a read
	// dependency on `geometry` and re-trigger the effect on subsequent
	// writes (which would cause an infinite fetch loop).
	let pendingDispose: BufferGeometry | null = null;

	const material = new MeshStandardMaterial({
		color: new Color(0xb8b8c0),
		emissive: new Color(0x1a1a22),
		roughness: 0.78,
		metalness: 0.18,
	});

	$effect(() => {
		const loc = LOCATION_MAP.get(location);
		if (!loc) { geometry = null; return; }
		pendingDispose?.dispose();
		pendingDispose = null;
		geometry = null;
		const ctrl = new AbortController();
		fetch(`/api/buildings/${location}`, { signal: ctrl.signal })
			.then((r) => r.json() as Promise<BuildingsResponse>)
			.then((data) => {
				if (!data.features?.length) return;
				const built = buildExtrusion(data.features, loc.lat, loc.lon);
				if (built) {
					pendingDispose = built.geom;
					geometry = built.geom;
					anchorMatrix = built.matrix;
				}
			})
			.catch((e) => { if (e.name !== 'AbortError') console.warn('[OsmBuildings]', e); });
		return () => ctrl.abort();
	});

	function buildExtrusion(
		features: BuildingFeature[],
		lat0: number,
		lon0: number,
	): { geom: BufferGeometry; matrix: Matrix4 } | null {
		const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
		const R = EARTH_RADIUS_M;
		const geometries: BufferGeometry[] = [];

		for (const f of features) {
			const ring = f.geometry.coordinates[0];
			if (!ring || ring.length < 4) continue;
			const shape = new Shape();
			for (let i = 0; i < ring.length - 1; i++) {
				const [lon, lat] = ring[i];
				const east  = ((lon - lon0) * Math.PI) / 180 * cosLat0 * R;
				const north = ((lat - lat0) * Math.PI) / 180 * R;
				if (i === 0) shape.moveTo(east, north);
				else shape.lineTo(east, north);
			}
			shape.closePath();
			const height = Math.max(3, f.properties.height ?? 8);
			const g = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
			// ExtrudeGeometry builds in the XY plane, extruded along +Z.
			// Rotate so extrusion runs along +Y (our local "up").
			g.rotateX(-Math.PI / 2);
			geometries.push(g);
		}
		if (!geometries.length) return null;

		// Merge into one BufferGeometry → single draw call.
		let totalVerts = 0;
		for (const g of geometries) totalVerts += g.attributes.position.count;
		const positions = new Float32Array(totalVerts * 3);
		const normals   = new Float32Array(totalVerts * 3);
		let offset = 0;
		for (const g of geometries) {
			g.computeVertexNormals();
			const p = g.attributes.position.array as Float32Array;
			const n = g.attributes.normal.array as Float32Array;
			positions.set(p, offset);
			normals.set(n, offset);
			offset += p.length;
			g.dispose();
		}
		const merged = new BufferGeometry();
		merged.setAttribute('position', new BufferAttribute(positions, 3));
		merged.setAttribute('normal',   new BufferAttribute(normals, 3));
		merged.computeBoundingSphere();

		// Anchor frame at (lat0, lon0) on the ellipsoid surface.
		//
		// Math verified at Hyderabad (17°N, 78°E):
		//   east  = worldY × up      → direction of increasing longitude
		//   north = up × east        → direction of increasing latitude
		//
		// After rotateX(-π/2), ExtrudeGeometry's +Z (extrusion) becomes the
		// mesh's +Y. The original 2D shape's +Y (north in ENU coords)
		// becomes -Z in the mesh local frame, so we pass north.clone().negate()
		// as the basis's +Z column so the world-space north and the mesh-
		// local -Z align — buildings 1 km NE of city centre land NE.
		const [x, y, z] = geoToCartesian(lat0, lon0, 0);
		const up    = new Vector3(x, y, z).normalize();
		const east  = new Vector3().crossVectors(new Vector3(0, 1, 0), up).normalize();
		const north = new Vector3().crossVectors(up, east).normalize();
		const matrix = new Matrix4().makeBasis(east, up, north.clone().negate());
		matrix.setPosition(x, y, z);
		return { geom: merged, matrix };
	}

</script>

{#if geometry && anchorMatrix}
	<T.Group
		oncreate={(g: ThreeGroup) => {
			g.matrixAutoUpdate = false;
			g.matrix.copy(anchorMatrix!);
		}}
	>
		<T.Mesh {geometry} {material} />
	</T.Group>
{/if}
