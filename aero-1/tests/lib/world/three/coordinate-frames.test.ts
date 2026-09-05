/**
 * Cesium↔Three coordinate-frame pins.
 *
 * `cesiumToThreeVec` (world/three/state.ts) is the SSOT for the
 * Cesium-ECEF → Three-world axis swap that CameraMirror applies to the
 * camera position, up vector, and lookAt target every frame. A wrong
 * swap doesn't throw — Three's overlay simply renders rotated/mirrored
 * against Cesium's terrain — so the mapping is pinned here directly.
 *
 * `enuAnchorMatrix` (world/three/enu.ts) is the pure ENU basis builder
 * Clouds.svelte anchors its deck with; pinned for basis orthonormality
 * and ellipsoid position.
 */
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { cesiumToThreeVec, geoToCartesian } from '$lib/world/three/state';
import { enuAnchorMatrix } from '$lib/world/three/enu';

const WGS84_A = 6_378_137; // equatorial radius (state.ts keeps its own private copy)
const WGS84_E2 = 0.0066943799901413165; // first eccentricity² (same as state.ts)

/** Reference WGS84 ECEF (Cesium convention: Z = north pole). */
function wgs84Ecef(latDeg: number, lonDeg: number, altM: number): [number, number, number] {
	const lat = (latDeg * Math.PI) / 180;
	const lon = (lonDeg * Math.PI) / 180;
	const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
	return [
		(N + altM) * Math.cos(lat) * Math.cos(lon),
		(N + altM) * Math.cos(lat) * Math.sin(lon),
		(N * (1 - WGS84_E2) + altM) * Math.sin(lat),
	];
}

describe('cesiumToThreeVec', () => {
	it('maps the ECEF basis axes onto the Three world axes', () => {
		// Component-wise (toBeCloseTo) so the negation's −0 doesn't trip
		// Object.is-based equality — the MAP is what matters here.
		const greenwich = cesiumToThreeVec(1, 0, 0);   // Greenwich+equator stays +X
		expect(greenwich[0]).toBeCloseTo(1); expect(greenwich[1]).toBeCloseTo(0); expect(greenwich[2]).toBeCloseTo(0);
		const pole = cesiumToThreeVec(0, 0, 1);        // north pole: ECEF +Z → Three +Y
		expect(pole[0]).toBeCloseTo(0); expect(pole[1]).toBeCloseTo(1); expect(pole[2]).toBeCloseTo(0);
		const east90 = cesiumToThreeVec(0, 1, 0);      // 90°E+equator: ECEF +Y → Three −Z
		expect(east90[0]).toBeCloseTo(0); expect(east90[1]).toBeCloseTo(0); expect(east90[2]).toBeCloseTo(-1);
	});

	it('agrees with geoToCartesian on WGS84 geography', () => {
		// geoToCartesian is documented as the same map applied to ECEF
		// geography — pin that the two never drift apart.
		const cases: [number, number, number][] = [
			[0, 0, 0],
			[36.17, -115.14, 10_668],   // Las Vegas at cruise
			[-33.86, 151.2, 500],       // Sydney, southern hemisphere
			[51.5, -0.12, 12_000],      // London
			[71.0, 25.8, 2_000],        // high latitude — ellipsoid gap is worst here
		];
		for (const [lat, lon, alt] of cases) {
			const [ex, ey, ez] = wgs84Ecef(lat, lon, alt);
			const viaSwap = cesiumToThreeVec(ex, ey, ez);
			const direct = geoToCartesian(lat, lon, alt);
			for (let i = 0; i < 3; i++) expect(viaSwap[i]).toBeCloseTo(direct[i], 6);
		}
	});

	it('is linear — a lookAt target (pos + dir×k) transforms componentwise', () => {
		// CameraMirror builds the lookAt target in Cesium space and then
		// swaps. Linearity is what makes that identical to swapping position
		// and direction separately; pin it so a future "optimisation" that
		// reorders the negate can't pass.
		const p: [number, number, number] = [6_378_000, 1_234_000, -4_321_000];
		const d: [number, number, number] = [0.3, -0.8, 0.52];
		const k = 200_000;
		const viaSum = cesiumToThreeVec(p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k);
		const tp = cesiumToThreeVec(...p);
		const td = cesiumToThreeVec(...d);
		for (let i = 0; i < 3; i++) expect(viaSum[i]).toBeCloseTo(tp[i] + td[i] * k, 6);
	});

	it('preserves vector length (rotation/reflection, no scaling)', () => {
		const v: [number, number, number] = [3_000, -4_000, 12_000];
		const t = cesiumToThreeVec(...v);
		expect(Math.hypot(...t)).toBeCloseTo(Math.hypot(...v), 9);
	});

	it('is an involution up to sign structure — applying it twice restores y and z', () => {
		// (x, z, −y) composed with itself is (x, −y, −z): NOT identity, so
		// pin the actual double-application result to keep anyone from
		// "simplifying" the map into a plain transpose.
		const v: [number, number, number] = [1, 2, 3];
		const twice = cesiumToThreeVec(...cesiumToThreeVec(...v));
		expect(twice).toEqual([1, -2, -3]);
	});
});

describe('enuAnchorMatrix', () => {
	const LAT = 36.17, LON = -115.14, ALT = 8_000;

	function columns(lat: number, lon: number, alt: number) {
		const e = enuAnchorMatrix(lat, lon, alt).elements;
		return {
			east: new Vector3(e[0], e[1], e[2]),
			up: new Vector3(e[4], e[5], e[6]),
			negNorth: new Vector3(e[8], e[9], e[10]),
			position: new Vector3(e[12], e[13], e[14]),
		};
	}

	it('places the anchor exactly at geoToCartesian(lat, lon, alt) on the ellipsoid', () => {
		for (const [lat, lon, alt] of [[0, 0, 0], [LAT, LON, ALT], [-33.86, 151.2, 500], [71.0, 25.8, 2_000]]) {
			const { position } = columns(lat, lon, alt);
			const [x, y, z] = geoToCartesian(lat, lon, alt);
			expect(position.x).toBeCloseTo(x, 6);
			expect(position.y).toBeCloseTo(y, 6);
			expect(position.z).toBeCloseTo(z, 6);
		}
	});

	it('has an orthonormal basis — unit columns, mutually orthogonal', () => {
		for (const [lat, lon, alt] of [[0, 0, 0], [LAT, LON, ALT], [-33.86, 151.2, 500], [71.0, 25.8, 2_000]]) {
			const { east, up, negNorth } = columns(lat, lon, alt);
			expect(east.length()).toBeCloseTo(1, 12);
			expect(up.length()).toBeCloseTo(1, 12);
			expect(negNorth.length()).toBeCloseTo(1, 12);
			expect(east.dot(up)).toBeCloseTo(0, 12);
			expect(east.dot(negNorth)).toBeCloseTo(0, 12);
			expect(up.dot(negNorth)).toBeCloseTo(0, 12);
		}
	});

	it('is a proper rotation (east × up = −north, determinant +1)', () => {
		const { east, up, negNorth } = columns(LAT, LON, ALT);
		const cross = new Vector3().crossVectors(east, up);
		expect(cross.distanceTo(negNorth)).toBeCloseTo(0, 12);
	});

	it('up axis points along the local surface normal; east has no polar component', () => {
		const { east, up, position } = columns(LAT, LON, ALT);
		// enu.ts defines up as normalize(geoToCartesian(...)) — pin that.
		expect(up.dot(position.clone().normalize())).toBeCloseTo(1, 12);
		// east = normalize(worldY × up) lies in the equatorial plane.
		expect(east.y).toBeCloseTo(0, 12);
	});

	it('maps local ENU offsets onto the tangent plane at the anchor', () => {
		// A sprite at local (1 km east, 0, 0) must land 1 km from the anchor,
		// perpendicular to the local up axis.
		const m = enuAnchorMatrix(LAT, LON, ALT);
		const local = new Vector3(1_000, 0, 0).applyMatrix4(m);
		const anchor = new Vector3(...geoToCartesian(LAT, LON, ALT));
		expect(local.distanceTo(anchor)).toBeCloseTo(1_000, 6);
		const up = anchor.clone().normalize();
		const offset = local.clone().sub(anchor);
		expect(offset.normalize().dot(up)).toBeCloseTo(0, 6);
	});
});
