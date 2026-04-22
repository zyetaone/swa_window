/**
 * water-mesh.ts — GeoJSON water polygon → Three.js Mesh with shader.
 *
 * This is the first feature-class of the artwork abstraction: water gets
 * its OWN ShaderMaterial driven by GeoJSON geometry, not a chroma-key on
 * the rendered frame. Pattern copied from the agent research:
 *
 *   GeoJSON rings
 *     → project via MapLibre MercatorCoordinate.fromLngLat
 *     → triangulate via THREE.Earcut
 *     → BufferGeometry + ShaderMaterial
 *     → THREE.Mesh added to a MapScene (shared MapLibre GL context)
 *
 * The shader is a first-pass port of `/playground/three/shaders/water.glsl`
 * simplified for in-world rendering: no chroma-key (the mesh IS the water
 * mask), no horizon gate (the geometry already only covers water), plus a
 * time uniform for scrolling normals.
 */

import * as THREE from 'three';
import { Earcut } from 'three/src/extras/Earcut.js';
import maplibregl from 'maplibre-gl';
import type { FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';

type WaterCollection = FeatureCollection<Polygon | MultiPolygon>;

/**
 * Project a lng/lat/alt triple into MapScene world units.
 *
 * MapScene uses MapLibre's MercatorCoordinate system: x/y are in [0,1]
 * across the whole world, z is meters scaled by the mercator factor at
 * the given latitude. We return a Vector3 in that same frame — it
 * composes correctly with MapLibre's camera matrix.
 */
function projectToWorld(lng: number, lat: number, alt = 0): THREE.Vector3 {
	const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, alt);
	return new THREE.Vector3(mc.x, mc.y, mc.z);
}

/**
 * Build a flat Three.js BufferGeometry from a GeoJSON polygon ring set.
 *
 * Rings[0] = outer boundary, rings[1..] = holes (lakes inside ocean etc).
 * Coordinates come in as [lng, lat, (alt)]. We project each vertex to
 * MapScene world coords, flatten to a 2D coordinate list for earcut,
 * triangulate, then build a 3D BufferGeometry using the same projected
 * vertices so the mesh sits at the correct world position.
 */
function ringsToGeometry(rings: Position[][]): THREE.BufferGeometry {
	// Project every vertex once; store the 3D positions and a parallel
	// flat 2D array for earcut.
	const projected3D: number[] = [];
	const flat2D: number[] = [];
	const holeIndices: number[] = [];
	let vertexCount = 0;

	rings.forEach((ring, ringIdx) => {
		if (ringIdx > 0) holeIndices.push(vertexCount);
		// Skip the last vertex if it duplicates the first (GeoJSON
		// convention closes rings with a repeat; earcut doesn't want it).
		const n = ring.length;
		const closes =
			ring.length > 1 &&
			ring[0][0] === ring[n - 1][0] &&
			ring[0][1] === ring[n - 1][1];
		const end = closes ? n - 1 : n;
		for (let i = 0; i < end; i++) {
			const [lng, lat] = ring[i];
			const v = projectToWorld(lng, lat, 0);
			projected3D.push(v.x, v.y, v.z);
			flat2D.push(v.x, v.y);
			vertexCount++;
		}
	});

	const indices = Earcut.triangulate(flat2D, holeIndices);

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(projected3D, 3));
	geom.setIndex(indices);
	geom.computeVertexNormals();
	return geom;
}

const WATER_VERT = /* glsl */ `
	varying vec2 vUvWorld;
	void main() {
		// vUvWorld carries the world-space xy so the fragment shader can
		// compute scrolling normals without needing texture UVs.
		vUvWorld = position.xy * 3.0e3;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const WATER_FRAG = /* glsl */ `
	precision highp float;

	uniform vec3  u_sunDir;        // screen-space sun direction (xy, z=altitude)
	uniform vec3  u_sunColor;
	uniform vec3  u_skyReflection;
	uniform vec3  u_waterBase;
	uniform float u_time;
	uniform float u_intensity;     // 0 = off, 1 = full

	varying vec2 vUvWorld;

	// Cheap procedural normal — two summed sin-fields drifting at
	// different speeds approximate scrolling normal-map wavelets.
	vec3 proceduralNormal(vec2 uv, float t) {
		float a = sin(uv.x * 12.0 + t * 0.9);
		float b = sin(uv.y * 9.0  + t * 0.6);
		float c = sin((uv.x + uv.y) * 7.0 + t * 1.3);
		float d = sin((uv.x - uv.y) * 11.0 - t * 0.8);
		vec2 n2 = vec2(a + c, b + d) * 0.12;
		return normalize(vec3(n2, 1.0));
	}

	void main() {
		vec3 n = proceduralNormal(vUvWorld, u_time);

		// Fresnel with a straight-up view proxy.
		float fresnel = pow(clamp(1.0 - n.z, 0.0, 1.0), 5.0);

		// Sun specular.
		vec3 sunDir = normalize(u_sunDir + vec3(1e-5));
		vec3 reflected = reflect(-sunDir, n);
		float specAngle = max(reflected.z, 0.0);
		float specular = pow(specAngle, 96.0) * clamp(u_sunDir.z, 0.0, 1.0);

		vec3 waterBase   = u_waterBase;
		vec3 reflection  = u_skyReflection * fresnel * 0.45;
		vec3 specularCol = u_sunColor * specular * 0.65;

		vec3 col = waterBase + reflection + specularCol;
		float alpha = mix(0.0, 0.82, u_intensity);
		gl_FragColor = vec4(col, alpha);
	}
`;

/**
 * Material factory. Shared across all water meshes in a scene so the
 * time uniform ticks once per frame and every water polygon animates
 * in lockstep.
 */
export function createWaterMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			u_sunDir: { value: new THREE.Vector3(0.4, 0.6, 0.7) },
			u_sunColor: { value: new THREE.Vector3(1.0, 0.95, 0.85) },
			u_skyReflection: { value: new THREE.Vector3(0.55, 0.7, 0.9) },
			u_waterBase: { value: new THREE.Vector3(0.12, 0.28, 0.42) },
			u_time: { value: 0 },
			u_intensity: { value: 1 },
		},
		vertexShader: WATER_VERT,
		fragmentShader: WATER_FRAG,
		transparent: true,
		depthWrite: false,
	});
}

/**
 * Build one THREE.Mesh per GeoJSON Polygon/MultiPolygon. Returns a Group
 * so the caller can add/remove in a single scene call.
 */
export function buildWaterGroup(
	collection: WaterCollection,
	material: THREE.ShaderMaterial,
): THREE.Group {
	const group = new THREE.Group();
	group.name = 'water-feature-group';

	for (const feature of collection.features) {
		if (feature.geometry.type === 'Polygon') {
			const geom = ringsToGeometry(feature.geometry.coordinates);
			group.add(new THREE.Mesh(geom, material));
		} else if (feature.geometry.type === 'MultiPolygon') {
			for (const polygon of feature.geometry.coordinates) {
				const geom = ringsToGeometry(polygon);
				group.add(new THREE.Mesh(geom, material));
			}
		}
	}

	return group;
}

/**
 * Hardcoded sample: a rough polygon covering the Gulf side of Dubai.
 * Used for the first spike — once the pattern is proven we swap in
 * real water data via `map.querySourceFeatures(...)`.
 */
export const DUBAI_GULF_SAMPLE: WaterCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: { name: 'Dubai Gulf (sample)' },
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						// Very rough outline — northwest of Dubai coastline into the Gulf.
						// Real data replaces this in the next commit.
						[54.8, 25.6],
						[55.2, 25.55],
						[55.3, 25.25],
						[55.1, 24.95],
						[54.85, 24.95],
						[54.7, 25.1],
						[54.72, 25.4],
						[54.8, 25.6],
					],
				],
			},
		},
	],
};
