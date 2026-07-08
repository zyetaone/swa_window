/**
 * viirs-field — bounded-retry + waiter semantics (M4).
 *
 * The kiosk-boot failure mode this guards: a transient network blip during
 * the first tile fetch used to mark the entry 'failed' PERMANENTLY, leaving
 * the neon dark/static until a full browser reload. The contract now:
 *   - network errors retry up to 3 times with linear backoff (1.5 s × fails)
 *   - waiters stay registered across retries and are notified exactly once,
 *     on terminal resolution (success or permanent failure)
 *   - removeViirsWaiter cancels a registration (component unmount)
 *
 * Image is stubbed (happy-dom does not load real network images) so each
 * load attempt is observable and onload/onerror are driven by the test.
 * Module-level caches persist across tests in this file, so every test uses
 * its own longitude → its own z7 tile key (tile width at z7 is 2.8125°).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { despeckle, getViirsField, removeViirsWaiter } from '$lib/world-three/viirs-field';

class FakeImage {
	static instances: FakeImage[] = [];
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	crossOrigin = '';
	src = '';
	constructor() {
		FakeImage.instances.push(this);
	}
}

/** Last load attempt (the module creates one Image per attempt). */
const lastImg = () => FakeImage.instances[FakeImage.instances.length - 1];

/** Fake 256² canvas whose pixels are all white → sample() ≈ 1 everywhere. */
function stubCanvas() {
	const fake = {
		width: 0,
		height: 0,
		getContext: () => ({
			drawImage: () => {},
			getImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4).fill(255) }),
		}),
	};
	vi.spyOn(document, 'createElement').mockReturnValue(fake as unknown as HTMLElement);
}

beforeEach(() => {
	FakeImage.instances = [];
	vi.stubGlobal('Image', FakeImage);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('getViirsField — load + cache', () => {
	it('returns null while loading and does not duplicate an in-flight load', () => {
		expect(getViirsField(0, 10)).toBeNull();
		expect(getViirsField(0, 10)).toBeNull();
		expect(FakeImage.instances).toHaveLength(1);
	});

	it('on success: caches the field, notifies the waiter once, samples luminance', () => {
		stubCanvas();
		const onReady = vi.fn();
		expect(getViirsField(0, 20, onReady)).toBeNull();
		lastImg().onload?.();
		expect(onReady).toHaveBeenCalledTimes(1);
		const field = getViirsField(0, 20);
		expect(field).not.toBeNull();
		expect(field!.sample(0, 20)).toBeCloseTo(1, 5);
		// Cached — no second load.
		expect(FakeImage.instances).toHaveLength(1);
	});
});

describe('getViirsField — bounded retry on network error', () => {
	it('retryable error: waiter NOT notified; retry scheduled at 1500 × fails', () => {
		const onReady = vi.fn();
		getViirsField(0, 30, onReady);
		lastImg().onerror?.();
		expect(onReady).not.toHaveBeenCalled();
		expect(FakeImage.instances).toHaveLength(1);
		// Backoff: first retry after 1500 ms, not before.
		vi.advanceTimersByTime(1499);
		expect(FakeImage.instances).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(FakeImage.instances).toHaveLength(2);
		// Second failure → retry after 3000 ms.
		lastImg().onerror?.();
		vi.advanceTimersByTime(2999);
		expect(FakeImage.instances).toHaveLength(2);
		vi.advanceTimersByTime(1);
		expect(FakeImage.instances).toHaveLength(3);
		expect(onReady).not.toHaveBeenCalled();
	});

	it('a retry that succeeds notifies the original waiter exactly once', () => {
		stubCanvas();
		const onReady = vi.fn();
		getViirsField(0, 40, onReady);
		lastImg().onerror?.();
		vi.advanceTimersByTime(1500);
		lastImg().onload?.();
		expect(onReady).toHaveBeenCalledTimes(1);
		expect(getViirsField(0, 40)).not.toBeNull();
	});

	it('manual re-entry during the backoff window restarts the load without a duplicate from the timer', () => {
		getViirsField(0, 50);
		lastImg().onerror?.(); // entry deleted, retry queued
		// A component calling again before the timer fires re-enters the load path…
		expect(getViirsField(0, 50)).toBeNull();
		expect(FakeImage.instances).toHaveLength(2);
		// …and the queued timer finds it 'loading' → no third Image.
		vi.advanceTimersByTime(1500);
		expect(FakeImage.instances).toHaveLength(2);
	});

	it('after 3 failures: marked failed permanently, waiter notified once, no further retries', () => {
		const onReady = vi.fn();
		getViirsField(0, 60, onReady);
		lastImg().onerror?.();
		vi.advanceTimersByTime(1500);
		lastImg().onerror?.();
		vi.advanceTimersByTime(3000);
		lastImg().onerror?.(); // third strike — terminal
		expect(onReady).toHaveBeenCalledTimes(1);
		expect(FakeImage.instances).toHaveLength(3);
		// Permanent: later calls return null and do NOT start a new load.
		expect(getViirsField(0, 60)).toBeNull();
		vi.advanceTimersByTime(60_000);
		expect(FakeImage.instances).toHaveLength(3);
	});
});

describe('despeckle — isolated-hot-pixel suppressor (RDT-192 v2)', () => {
	const W = 16, H = 16;
	/** Dark WxH RGBA buffer; set(x,y,v) paints a grey pixel of value v. */
	function buffer(): { data: Uint8ClampedArray; set: (x: number, y: number, v: number) => void; lum: (x: number, y: number) => number } {
		const data = new Uint8ClampedArray(W * H * 4);
		const set = (x: number, y: number, v: number) => {
			const p = (y * W + x) * 4;
			data[p] = data[p + 1] = data[p + 2] = v;
		};
		const lum = (x: number, y: number) => {
			const p = (y * W + x) * 4;
			return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
		};
		return { data, set, lum };
	}

	it('folds a lone hot pixel down to its (dark) neighbourhood mean', () => {
		const b = buffer();
		b.set(8, 8, 255);
		expect(despeckle(b.data, W, H)).toBe(1);
		expect(b.lum(8, 8)).toBe(0); // 8 dark neighbours → mean 0 → folded to 0
	});

	it('preserves a 1-px-wide bright line INCLUDING its endpoints (roads/filaments)', () => {
		const b = buffer();
		for (let x = 2; x < 14; x++) b.set(x, 8, 255); // horizontal string
		expect(despeckle(b.data, W, H)).toBe(0);
		expect(b.lum(8, 8)).toBe(255); // interior
		expect(b.lum(2, 8)).toBe(255); // endpoint — one lit neighbour must suffice
	});

	it('preserves a 2×2 block (a real small town)', () => {
		const b = buffer();
		b.set(8, 8, 255); b.set(9, 8, 255); b.set(8, 9, 255); b.set(9, 9, 255);
		expect(despeckle(b.data, W, H)).toBe(0);
		expect(b.lum(8, 8)).toBe(255);
	});

	it('leaves dim pixels below the HOT threshold untouched', () => {
		const b = buffer();
		b.set(8, 8, 10); // below HOT=12 — faint rural glow, not an orphan
		expect(despeckle(b.data, W, H)).toBe(0);
		expect(b.lum(8, 8)).toBeCloseTo(10, 5);
	});

	it('suppresses a dim orphan just above the consumer floor (HOT ≤ floor — review finding)', () => {
		const b = buffer();
		// 15/255 ≈ 0.059 — above CityLightField's 0.05 BRIGHT_FLOOR. With the
		// old HOT=24 this survived despeckle AND passed the floor → orphan dot.
		b.set(8, 8, 15);
		expect(despeckle(b.data, W, H)).toBe(1);
		expect(b.lum(8, 8)).toBe(0);
	});

	it('pins the accepted limit: a 2-px noise pair mutually shields and survives', () => {
		const b = buffer();
		b.set(8, 8, 255);
		b.set(9, 8, 255); // each is the other's one lit neighbour (mean = 1/8 ≥ ISOLATION)
		expect(despeckle(b.data, W, H)).toBe(0);
	});

	it('field integration: a decoded lone hot pixel can no longer clear the floor', () => {
		// lon=94.21875 → lonToTileXf=97.5 → tile_x=97, pixel_x=128.
		// lat=-1.4082 → latToTileYf≈64.5 → tile_y=64, pixel_y=128.
		// Tile key 7/64/97 — fresh, so the module-level cache does not
		// carry over from other tests in this file.
		const pixels = new Uint8ClampedArray(256 * 256 * 4).fill(0);
		const ci = (128 * 256 + 128) * 4;
		pixels[ci] = pixels[ci + 1] = pixels[ci + 2] = 255; // single white pixel
		vi.spyOn(document, 'createElement').mockReturnValue({
			width: 0,
			height: 0,
			getContext: () => ({
				drawImage: () => {},
				getImageData: () => ({ data: pixels }),
			}),
		} as unknown as HTMLElement);
		const lat = -1.4082, lon = 94.21875;
		getViirsField(lat, lon);
		lastImg().onload?.();
		const field = getViirsField(lat, lon)!;
		// Pre-despeckle this read 1.0 at the pixel's own centre — the exact
		// orphan-dot pathology. Decode-time despeckle kills it at the source
		// for EVERY sampler.
		expect(field.sample(lat, lon)).toBeCloseTo(0, 5);
		expect(field.sampleBilinear(lat, lon)).toBeCloseTo(0, 5);
	});
});

describe('removeViirsWaiter', () => {
	it('a removed waiter is not notified on terminal resolution', () => {
		stubCanvas();
		const removed = vi.fn();
		const kept = vi.fn();
		getViirsField(0, 70, removed);
		getViirsField(0, 70, kept);
		removeViirsWaiter(0, 70, removed);
		lastImg().onload?.();
		expect(removed).not.toHaveBeenCalled();
		expect(kept).toHaveBeenCalledTimes(1);
	});

	it('is a no-op for an unknown tile or unregistered callback', () => {
		expect(() => removeViirsWaiter(45, 80, () => {})).not.toThrow();
	});
});
