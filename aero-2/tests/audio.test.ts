import { describe, it, expect } from 'vitest';
import {
	AmbientAudioEngine,
	clamp01,
	engineCutoffHz
} from '../src/lib/display/media/ambient-audio.js';

describe('ambient-audio math', () => {
	it('clamps volume inputs safely without NaN poisoning', () => {
		expect(clamp01(0.5)).toBe(0.5);
		expect(clamp01(-0.2)).toBe(0);
		expect(clamp01(1.5)).toBe(1);
		expect(clamp01(NaN)).toBe(0);
	});

	it('computes realistic altitude-dependent engine lowpass cutoff frequency', () => {
		expect(engineCutoffHz(0)).toBe(220);
		expect(engineCutoffHz(12_000)).toBe(110);
		expect(engineCutoffHz(6_000)).toBe(165);
		expect(engineCutoffHz(NaN)).toBe(220);
	});
});

/**
 * `init()` must be safe to call on every user gesture.
 *
 * AudioHost used to guard it with a local `initialized` latch that was set on
 * the first gesture WHATEVER the mode, but only called `init()` when the mode
 * was already `synth`. A kiosk that booted in `playlist` (reachable by
 * `?audio=playlist`), took one click, and was later switched to `synth` had a
 * latched flag and no audio context — `setVolume` returns early on `!ctx`, so
 * the result is silence forever with the drawer reading "synth".
 *
 * The fix moves the gate into the engine, so these assert the engine really is
 * idempotent rather than trusting that it is.
 */
describe('AmbientAudioEngine lifecycle', () => {
	class FakeAudioContext {
		static made = 0;
		state = 'running';
		sampleRate = 48_000;
		currentTime = 0;
		destination = {};
		constructor() {
			FakeAudioContext.made++;
		}
		createGain() {
			return { gain: { value: 0, setTargetAtTime() {} }, connect() {} };
		}
		createBiquadFilter() {
			return {
				type: '',
				frequency: { value: 0, setTargetAtTime() {} },
				Q: { value: 0 },
				connect() {}
			};
		}
		createBuffer(_c: number, len: number) {
			return { getChannelData: () => new Float32Array(len) };
		}
		createBufferSource() {
			return { buffer: null, loop: false, connect() {}, start() {} };
		}
		resume() {
			return Promise.resolve();
		}
		close() {
			return Promise.resolve();
		}
	}

	const withFakeAudio = async (fn: (E: typeof AmbientAudioEngine) => void) => {
		const g = globalThis as unknown as { window?: unknown; AudioContext?: unknown };
		const prevWindow = g.window;
		FakeAudioContext.made = 0;
		g.window = { AudioContext: FakeAudioContext };
		try {
			fn(AmbientAudioEngine);
		} finally {
			g.window = prevWindow;
		}
	};

	it('builds exactly one context however many times init is called', async () => {
		await withFakeAudio((E) => {
			const e = new E();
			e.init();
			e.init();
			e.init();
			expect(FakeAudioContext.made).toBe(1);
		});
	});

	it('setVolume before init is a no-op, not a throw', async () => {
		await withFakeAudio((E) => {
			const e = new E();
			expect(() => e.setVolume(0.5, true)).not.toThrow();
			expect(() => e.setAltitude(9000)).not.toThrow();
		});
	});

	it('can be re-initialised after destroy', async () => {
		await withFakeAudio((E) => {
			const e = new E();
			e.init();
			e.destroy();
			e.init();
			expect(FakeAudioContext.made, 'destroy left the engine unusable').toBe(2);
			expect(() => e.setVolume(0.5, true)).not.toThrow();
		});
	});
});
