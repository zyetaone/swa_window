/**
 * Camera sync module — pin the math.
 *
 * `syncCamera(slice, resources, scratchDest)` is the per-frame body that
 * CesiumManager previously owned as a 14-line `#syncCamera` method. The
 * function is pure with respect to its arguments, so we drive it with a
 * hand-rolled Cesium stub and assert the captured setView inputs.
 */
import { describe, it, expect } from 'vitest';
import type { Cartesian3, Viewer } from 'cesium';
import { syncCamera } from '$lib/world/camera';

interface CapturedCall {
	destination: Cartesian3;
	orientation: { heading: number; pitch: number; roll: number };
}

/** Typed camera stub — only setView is captured; the rest of Viewer is unused. */
function makeViewer(): { viewer: Pick<Viewer, 'camera'>; captured: CapturedCall[] } {
	const captured: CapturedCall[] = [];
	const viewer = {
		camera: {
			setView(input: CapturedCall) {
				captured.push(input);
			},
		},
	} as Pick<Viewer, 'camera'>;
	return { viewer, captured };
}

function makeCesiumStub() {
	return {
		Cartesian3: {
			fromDegrees: (
				_lon: number,
				_lat: number,
				_alt: number,
				_unused: undefined,
				dest: Cartesian3,
			) => {
				dest.x = _lon;
				dest.y = _lat;
				dest.z = _alt;
				return dest;
			},
		},
		Math: { toRadians: (deg: number) => (deg * Math.PI) / 180 },
	};
}

function makeSlice(overrides: {
	camLon?: number;
	camLat?: number;
	camAlt?: number;
	camHeading?: number;
	camPitch?: number;
	bankAngle?: number;
	bankPitchCouple?: number;
	flyoverPitchDeg?: number;
	effectiveHeading?: (base: number) => number;
} = {}) {
	const flight = {
		camLon: 0,
		camLat: 0,
		camAlt: 30000,
		camHeading: 0,
		camPitch: 90,
	};
	for (const k of ['camLon', 'camLat', 'camAlt', 'camHeading', 'camPitch'] as const) {
		if (overrides[k] !== undefined) flight[k] = overrides[k];
	}
	const motion = { bankAngle: overrides.bankAngle ?? 0 };
	return {
		flight,
		motion,
		config: {
			camera: {
				effectiveHeading: overrides.effectiveHeading ?? ((b: number) => b),
				motion: { bankPitchCouple: overrides.bankPitchCouple ?? 0 },
				flyoverPitchDeg: overrides.flyoverPitchDeg ?? 0,
			},
		},
	};
}

function last<T>(arr: T[]): T {
	const v = arr[arr.length - 1];
	if (v === undefined) throw new Error('no captured call');
	return v;
}

describe('syncCamera', () => {
	it('writes destination lon/lat and feet→metres-converted altitude into scratch', () => {
		const { viewer, captured } = makeViewer();
		const scratch = { x: 0, y: 0, z: 0 } as unknown as Cartesian3;
		syncCamera(
			makeSlice({ camLon: -122, camLat: 37, camAlt: 10000 }),
			// Cesium stub matches the typeof module the camera module expects;
			// unchecked cast is intentional here — the test pins syncCamera
			// behaviour, not Cesium's API.
			{ Cesium: makeCesiumStub() as never, viewer: viewer as unknown as Viewer },
			scratch,
		);
		const s = scratch as unknown as { x: number; y: number; z: number };
		expect(s.x).toBe(-122);
		expect(s.y).toBe(37);
		expect(s.z).toBeCloseTo(3048); // 10 000 ft → 3048 m
		expect(last(captured).destination).toBe(scratch);
	});

	it('camPitch = straight-down reads as Cesium horizon pitch (camPitch - 90)', () => {
		const { viewer, captured } = makeViewer();
		syncCamera(
			makeSlice({ camPitch: 90 }),
			{ Cesium: makeCesiumStub() as never, viewer: viewer as unknown as Viewer },
			{ x: 0, y: 0, z: 0 } as unknown as Cartesian3,
		);
		expect(last(captured).orientation.pitch).toBe(0); // 90 - 90 = 0°
	});

	it('flyoverPitchDeg overrides the camPitch frame conversion when non-zero', () => {
		const { viewer, captured } = makeViewer();
		syncCamera(
			makeSlice({ camPitch: 90, flyoverPitchDeg: 15 }),
			{ Cesium: makeCesiumStub() as never, viewer: viewer as unknown as Viewer },
			{ x: 0, y: 0, z: 0 } as unknown as Cartesian3,
		);
		expect(last(captured).orientation.pitch).toBeCloseTo((15 * Math.PI) / 180);
	});

	it('couples pitch to bank when bankPitchCouple > 0', () => {
		const { viewer, captured } = makeViewer();
		syncCamera(
			makeSlice({ camPitch: 90, bankAngle: 10, bankPitchCouple: 0.5 }),
			{ Cesium: makeCesiumStub() as never, viewer: viewer as unknown as Viewer },
			{ x: 0, y: 0, z: 0 } as unknown as Cartesian3,
		);
		expect(last(captured).orientation.pitch).toBeCloseTo((-5 * Math.PI) / 180);
	});

	it('roll is the negation of bankAngle, in radians', () => {
		const { viewer, captured } = makeViewer();
		syncCamera(
			makeSlice({ bankAngle: 12.5 }),
			{ Cesium: makeCesiumStub() as never, viewer: viewer as unknown as Viewer },
			{ x: 0, y: 0, z: 0 } as unknown as Cartesian3,
		);
		expect(last(captured).orientation.roll).toBeCloseTo((-12.5 * Math.PI) / 180);
	});

	it('heading combines effectiveHeading output with SEAT_LOOK_DEG', () => {
		const { viewer, captured } = makeViewer();
		syncCamera(
			makeSlice({
				camHeading: 90,
				effectiveHeading: (base) => base + 10,
			}),
			{ Cesium: makeCesiumStub() as never, viewer: viewer as unknown as Viewer },
			{ x: 0, y: 0, z: 0 } as unknown as Cartesian3,
		);
		// camHeading → effective(90+10) → +SEAT_LOOK_DEG(90) = 190° → radians
		expect(last(captured).orientation.heading).toBeCloseTo((190 * Math.PI) / 180);
	});

	it('heading wraps at 360°', () => {
		const { viewer, captured } = makeViewer();
		syncCamera(
			makeSlice({ camHeading: 350, effectiveHeading: (b) => b + 20 }),
			{ Cesium: makeCesiumStub() as never, viewer: viewer as unknown as Viewer },
			{ x: 0, y: 0, z: 0 } as unknown as Cartesian3,
		);
		// (350 + 20 + 90_SEAT) % 360 = 100° → radians
		expect(last(captured).orientation.heading).toBeCloseTo((100 * Math.PI) / 180);
	});

	it('does not allocate per frame — same scratch buffer is reused', () => {
		const { viewer, captured } = makeViewer();
		const scratch = { x: 0, y: 0, z: 0 } as unknown as Cartesian3;
		const S = { Cesium: makeCesiumStub() as never, viewer: viewer as unknown as Viewer };
		syncCamera(makeSlice({ camLon: 0, camLat: 0 }), S, scratch);
		syncCamera(makeSlice({ camLon: 1, camLat: 2 }), S, scratch);
		expect(captured.length).toBe(2);
		expect(last(captured).destination).toBe(scratch);
		expect(captured[0].destination).toBe(scratch);
	});
});
