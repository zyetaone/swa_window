/**
 * Cabin ambience — synthesized, not sampled.
 *
 * There is no audio file anywhere in this repo and there should not be one.
 * A jet cabin drone IS filtered noise, so generating it costs a few nodes and
 * buys four things a recording cannot:
 *
 *   1. No licence. Every other media source in this product turned out to be
 *      a licensing problem (EOX NonCommercial, CARTO Enterprise-only) and the
 *      genuinely CC0 audio libraries gate downloads behind an account. A
 *      waveform we compute is unambiguously ours.
 *   2. No bytes. The offline-tile experience says an asset that must be
 *      shipped to the Pis is an asset that eventually ISN'T on the Pis.
 *   3. No loop seam. A recorded loop clicks where its endpoints disagree.
 *   4. It can follow the flight. Cutoff tracks altitude, so a climb actually
 *      sounds like a climb. A static loop is the same at 3,000 ft and 35,000.
 *
 * ─── Why white noise and not brown ──────────────────────────────────────────
 * Cabin rumble is low-frequency, so the obvious move is to fill the buffer
 * with brown noise. Don't. Brown noise is a random walk, so the buffer's last
 * sample and its first are uncorrelated and the loop point pops once per
 * cycle — audible forever in a 24/7 install. White noise is memoryless, so
 * ANY two points join seamlessly. We loop white and do the colouring live in
 * a BiquadFilter, whose internal state carries across the loop boundary. The
 * result is seam-free by construction rather than by tuning.
 *
 * ─── Why this is NOT fleet-synchronized ─────────────────────────────────────
 * The ambient-jitter bug taught us that unsynchronized randomness across the
 * three panes is visible. Audio is the exception, and deliberately so: three
 * speakers emitting uncorrelated noise sum to diffuse broadband sound, which
 * is what a cabin actually is. Phase-locking them would instead create comb
 * filtering at the seams — a worse artifact than the one we'd be preventing.
 * Only the MUSIC layer needs a leader gate (see `setMusic`), because a melody
 * played three times a few hundred ms apart is a flam, not ambience.
 */

/**
 * Clamp to 0..1, mapping NaN to 0.
 *
 * ─── NOT a duplicate of `clamp(v, 0, 1)` from $lib/utils ────────────────────
 * That one is `Math.max(min, Math.min(max, value))`, and both of those return
 * NaN when handed NaN. Here the input is a volume that came off an admin
 * slider or persisted JSON, and the output goes straight into an AudioParam:
 * a NaN there does not clamp to silence, it poisons the param and the layer
 * stops responding for the rest of the session — with no error.
 *
 * Left local and named differently on purpose. If a future dedup pass folds
 * this into the shared clamp, that bug comes back silently.
 */
function clamp01(n: number): number {
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/**
 * Engine lowpass cutoff for a given altitude.
 *
 * Higher and thinner: at cruise the airframe sits above most of the
 * turbulent boundary layer and the cabin reads as a duller, more distant
 * rumble; low passes are brighter and closer. Ranges 220 Hz at sea level
 * down to 110 Hz at 40,000 ft, clamped at both ends so a NaN or an absurd
 * altitude can never hand the filter a negative or inaudible cutoff.
 *
 * Exported for test: the node it drives only exists after a real
 * AudioContext, so this is the only place the curve can be asserted.
 */
export function engineCutoffHz(altitudeFt: number): number {
	if (!Number.isFinite(altitudeFt)) return 220;
	const t = Math.min(1, Math.max(0, altitudeFt / 40_000));
	return 220 - t * 110;
}

/**
 * Final gain for one layer: master × layer, zeroed when muted.
 * Multiplicative so the master slider behaves like a real mixer fader
 * rather than fighting the per-layer values.
 */
export function layerGain(enabled: boolean, master: number, layer: number): number {
	if (!enabled) return 0;
	return clamp01(master) * clamp01(layer);
}

/** Seconds of white noise held in the looping buffer. */
const NOISE_SECONDS = 2;

/** Ramp time for every gain change — instant jumps click. */
const RAMP_S = 0.25;

export interface AmbientAudioState {
	enabled: boolean;
	masterVolume: number;
	engineVolume: number;
	weatherVolume: number;
	musicVolume: number;
	/** Empty string = no music. Never bundled; operator-supplied. */
	musicUrl: string;
}

/**
 * Owns the AudioContext and one gain node per layer.
 *
 * Constructed lazily — `apply()` with `enabled:false` never touches the Web
 * Audio API at all, so a kiosk with audio off pays nothing and a test
 * environment without AudioContext never throws.
 */
export class AmbientAudio {
	#ctx: AudioContext | null = null;
	#master: GainNode | null = null;
	#engineGain: GainNode | null = null;
	#weatherGain: GainNode | null = null;
	#musicGain: GainNode | null = null;
	#engineFilter: BiquadFilterNode | null = null;
	#music: HTMLAudioElement | null = null;
	#musicSrc = '';
	#started = false;

	/** True once a context exists — lets callers skip work when silent. */
	get active(): boolean {
		return this.#started;
	}

	/**
	 * Build the graph. Safe to call repeatedly; only the first call does work.
	 * Returns false when Web Audio is unavailable (SSR, jsdom, locked-down
	 * browser) so callers can degrade to silence rather than crash the kiosk.
	 */
	#ensure(): boolean {
		if (this.#started) return true;
		const Ctor =
			typeof globalThis !== 'undefined'
				? (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
				: undefined;
		if (!Ctor) return false;

		let ctx: AudioContext;
		try {
			ctx = new Ctor();
		} catch {
			return false; // never take the window down over ambience
		}

		const master = ctx.createGain();
		master.gain.value = 0;
		master.connect(ctx.destination);

		// One white-noise buffer feeds both noise layers. Two independent
		// sources would double the memory for no audible benefit — the
		// filters after them are what make the layers distinct.
		const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS);
		const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

		// ─── Engine: white → lowpass → gain ──────────────────────────────────
		const engineSrc = ctx.createBufferSource();
		engineSrc.buffer = buffer;
		engineSrc.loop = true;
		const engineFilter = ctx.createBiquadFilter();
		engineFilter.type = 'lowpass';
		engineFilter.frequency.value = engineCutoffHz(0);
		// Q just above the 0.707 Butterworth default: a slight resonance at the
		// corner reads as the turbine's tonal component without needing a
		// separate oscillator to fake it.
		engineFilter.Q.value = 1.2;
		const engineGain = ctx.createGain();
		engineGain.gain.value = 0;
		engineSrc.connect(engineFilter).connect(engineGain).connect(master);
		engineSrc.start();

		// ─── Weather: white → bandpass → gain ────────────────────────────────
		// Rain on glass lives in the 1-3 kHz band; a wide Q keeps it as a hiss
		// rather than a whistle.
		const weatherSrc = ctx.createBufferSource();
		weatherSrc.buffer = buffer;
		weatherSrc.loop = true;
		const weatherFilter = ctx.createBiquadFilter();
		weatherFilter.type = 'bandpass';
		weatherFilter.frequency.value = 2000;
		weatherFilter.Q.value = 0.6;
		const weatherGain = ctx.createGain();
		weatherGain.gain.value = 0;
		weatherSrc.connect(weatherFilter).connect(weatherGain).connect(master);
		weatherSrc.start();

		const musicGain = ctx.createGain();
		musicGain.gain.value = 0;
		musicGain.connect(master);

		this.#ctx = ctx;
		this.#master = master;
		this.#engineGain = engineGain;
		this.#weatherGain = weatherGain;
		this.#musicGain = musicGain;
		this.#engineFilter = engineFilter;
		this.#started = true;
		return true;
	}

	/**
	 * Ramp a param instead of stepping it — a step is a click.
	 *
	 * Skips when the target hasn't moved. Callers are driven by an $effect on
	 * scene state, and re-issuing cancelScheduledValues + setTargetAtTime for
	 * an unchanged target doesn't just waste work: cancelling restarts the
	 * ramp from wherever it got to, so a target re-sent faster than RAMP_S
	 * converges asymptotically and never actually arrives. The guard is what
	 * makes the ramp finish.
	 */
	#ramp(node: GainNode | null, value: number): void {
		const ctx = this.#ctx;
		if (!node || !ctx) return;
		if (Math.abs(node.gain.value - value) < 1e-4) return;
		node.gain.cancelScheduledValues(ctx.currentTime);
		node.gain.setTargetAtTime(value, ctx.currentTime, RAMP_S);
	}

	/**
	 * Push the current config + flight state into the graph.
	 *
	 * `wet` is how much weather layer to run (0 clear .. 1 heavy rain) — the
	 * caller maps its own weather enum, so this module stays ignorant of the
	 * weather vocabulary.
	 *
	 * `musicAllowed` is the leader gate. Followers pass false: they still run
	 * engine and weather (uncorrelated noise is fine, see header) but never
	 * the music bed.
	 */
	apply(
		state: AmbientAudioState,
		opts: { altitudeFt: number; wet: number; musicAllowed: boolean },
	): void {
		if (!state.enabled) {
			// Don't tear the graph down — the operator may be toggling. Just
			// fade to silence and stop any music element.
			if (this.#started) {
				this.#ramp(this.#master, 0);
				this.#music?.pause();
			}
			return;
		}
		if (!this.#ensure()) return;

		this.#ramp(this.#master, clamp01(state.masterVolume));
		this.#ramp(this.#engineGain, layerGain(true, 1, state.engineVolume));
		this.#ramp(
			this.#weatherGain,
			layerGain(true, 1, state.weatherVolume) * clamp01(opts.wet),
		);

		const ctx = this.#ctx;
		if (this.#engineFilter && ctx) {
			// Same guard as #ramp, for the same reason: callers re-apply on
			// every scene change, and re-targeting an unchanged cutoff would
			// restart the glide forever. Callers also quantize altitude (see
			// AmbientAudioHost) so this is reached seldom rather than per frame.
			const hz = engineCutoffHz(opts.altitudeFt);
			if (Math.abs(this.#engineFilter.frequency.value - hz) > 0.5) {
				this.#engineFilter.frequency.setTargetAtTime(
					hz,
					ctx.currentTime,
					1.5, // slow — altitude changes over minutes, not frames
				);
			}
		}

		this.setMusic(state.musicUrl, state.musicVolume, opts.musicAllowed);
	}

	/**
	 * Point the music layer at a URL. Empty URL, or a follower pane, means
	 * silence — the element is paused rather than destroyed so toggling the
	 * leader role doesn't re-download the file.
	 */
	setMusic(url: string, volume: number, allowed: boolean): void {
		if (!allowed || !url) {
			this.#music?.pause();
			this.#ramp(this.#musicGain, 0);
			return;
		}
		if (!this.#ensure()) return;
		const ctx = this.#ctx;
		if (!ctx || !this.#musicGain) return;

		if (this.#musicSrc !== url) {
			this.#music?.pause();
			const el = new Audio(url);
			el.loop = true;
			el.crossOrigin = 'anonymous';
			// Route through the graph so the master fader governs music too.
			try {
				ctx.createMediaElementSource(el).connect(this.#musicGain);
			} catch {
				// Already-connected element or a CORS-tainted stream: fall back
				// to element volume so music still plays, just outside the bus.
				el.volume = clamp01(volume);
			}
			this.#music = el;
			this.#musicSrc = url;
		}
		this.#ramp(this.#musicGain, clamp01(volume));
		// Only when actually stopped. play() on a playing element is harmless
		// but allocates a Promise per call, and this runs off a scene $effect —
		// per-frame promise churn is exactly the kind of thing that shows up as
		// GC sawtooth on a Pi and nowhere else.
		// The kiosk ships --autoplay-policy=no-user-gesture-required, so the
		// rejection path only bites in dev and on the admin iPad.
		if (this.#music?.paused) void this.#music.play().catch(() => {});
	}

	/**
	 * Browsers start the context suspended until a gesture. The kiosk flag
	 * covers the Pis; call this from a pointer handler so dev browsers work
	 * too. Silent no-op when there's nothing to resume.
	 */
	resume(): void {
		if (this.#ctx?.state === 'suspended') void this.#ctx.resume().catch(() => {});
	}

	/** Release everything. Safe to call when never started. */
	dispose(): void {
		this.#music?.pause();
		this.#music = null;
		this.#musicSrc = '';
		void this.#ctx?.close().catch(() => {});
		this.#ctx = null;
		this.#master = null;
		this.#engineGain = null;
		this.#weatherGain = null;
		this.#musicGain = null;
		this.#engineFilter = null;
		this.#started = false;
	}
}
