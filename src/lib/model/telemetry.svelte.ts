/**
 * Telemetry — ring-buffer observability for the display.
 *
 * Two independent measurements, deliberately not conflated:
 *
 *   tickMs   — how long the model's own simulation step costs (CPU only).
 *   periodMs — wall-clock gap between consecutive frames, i.e. what the
 *              audience actually sees. `fps` is derived from this.
 *
 * The distinction matters: the tick is ~0.2 ms while the panel renders at
 * ~3 fps (330 ms/frame). Reading `1000 / tickMsP50` as a frame rate reports
 * ~5000 fps and is how a GPU regression once passed review.
 *
 * Neither measurement adds measurable cost to the tick — per-frame writes go
 * into plain non-reactive buffers, flushed to reactive state in batches.
 *
 * Usage:
 *   telemetry.recordFrame(tickCostMs);                 // per-tick, cheap
 *   telemetry.recordFramePeriod(sinceLastFrameMs);     // per-tick, cheap
 *   telemetry.fps                                      // real, unquantized
 *   telemetry.recordEvent('config_patch', { path });   // rare, reactive
 */

import { untrack } from 'svelte';

type TelemetryKind =
	| 'config_patch'
	| 'fleet_in'
	| 'fleet_out'
	| 'error'
	| 'info';

interface TelemetryEvent {
	t: number;
	kind: TelemetryKind;
	payload: unknown;
}

interface TelemetryCounts {
	configPatches: number;
	fleetIn: number;
	fleetOut: number;
	errors: number;
}

interface TelemetrySnapshot {
	tick: { recent: number[]; p50: number; p95: number };
	frame: { recent: number[]; p50: number; p95: number };
	fps: number;
	fpsLow: number;
	events: TelemetryEvent[];
	counts: TelemetryCounts;
}

const SAMPLE_WINDOW = 120;
const EVENT_CAP = 500;
// Flush samples to reactive state every N. Keeps per-tick cost to a plain
// push into a non-reactive buffer — ~40 ns vs ~μs for a reactive write that
// would trigger derived recomputation.
const TICK_FLUSH_EVERY = 30;
// Frame periods flush sooner: `fps` gates the boot lockup and the liveness
// watchdog, so it must go non-zero within a couple of frames rather than
// after 30. At 3 fps, 30 samples would be a 10-second blind window.
const PERIOD_FLUSH_EVERY = 10;

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
	return sorted[idx];
}

function pctOf(arr: number[], p: number): number {
	if (arr.length === 0) return 0;
	return percentile([...arr].sort((a, b) => a - b), p);
}

export class Telemetry {
	// Reactive surfaces — read by UI, written in coarse batches.
	// $state.raw keeps array re-assignments cheap (no proxy traversal).
	tickMsRecent = $state.raw<number[]>([]);
	periodMsRecent = $state.raw<number[]>([]);
	events = $state.raw<TelemetryEvent[]>([]);
	counts = $state<TelemetryCounts>({
		configPatches: 0,
		fleetIn: 0,
		fleetOut: 0,
		errors: 0,
	});

	// Non-reactive scratch buffers filled per-frame; flushed in batches.
	#tickBuffer: number[] = [];
	#periodBuffer: number[] = [];

	// Model tick CPU cost (ms). NOT a frame rate — see the header note.
	tickMsP50 = $derived.by(() => pctOf(this.tickMsRecent, 0.5));
	tickMsP95 = $derived.by(() => pctOf(this.tickMsRecent, 0.95));

	// Wall-clock frame period (ms) — the real render cadence.
	frameMsP50 = $derived.by(() => pctOf(this.periodMsRecent, 0.5));
	frameMsP95 = $derived.by(() => pctOf(this.periodMsRecent, 0.95));

	/**
	 * Frame rate, from the median frame period. Deliberately not a
	 * frames-per-wall-second counter: at 2–4 fps such a counter divides a
	 * 3-frame count by a ~1 s window and lands on integers only, so a 33 %
	 * regression can read as no change at all. A median period keeps
	 * fractional resolution and is robust to a single stalled frame.
	 */
	fps = $derived.by(() => {
		const p50 = this.frameMsP50;
		return p50 > 0 ? Math.round((1000 / p50) * 10) / 10 : 0;
	});

	/** Worst-case frame rate (from the p95 period) — the visible stutter floor. */
	fpsLow = $derived.by(() => {
		const p95 = this.frameMsP95;
		return p95 > 0 ? Math.round((1000 / p95) * 10) / 10 : 0;
	});

	/**
	 * Record the model tick's own CPU cost (ms). Hot path — avoids reactive
	 * writes by appending to a plain array and flushing every N samples.
	 */
	recordFrame(durationMs: number): void {
		if (!Number.isFinite(durationMs) || durationMs < 0) return;
		this.#tickBuffer.push(durationMs);
		if (this.#tickBuffer.length >= TICK_FLUSH_EVERY) this.#flushTicks();
	}

	/**
	 * Record the wall-clock gap since the previous frame (ms). Hot path.
	 * Must be the *unclamped* real interval — the game loop clamps its `dt`
	 * to 100 ms to keep the simulation stable, which would floor every
	 * reading below 10 fps at exactly 10 fps.
	 */
	recordFramePeriod(periodMs: number): void {
		if (!Number.isFinite(periodMs) || periodMs <= 0) return;
		this.#periodBuffer.push(periodMs);
		// Flush the first sample immediately so `fps` is live from frame two.
		const threshold =
			untrack(() => this.periodMsRecent).length === 0 ? 1 : PERIOD_FLUSH_EVERY;
		if (this.#periodBuffer.length >= threshold) this.#flushPeriods();
	}

	#flushTicks(): void {
		this.tickMsRecent = this.#drain(this.#tickBuffer, () => this.tickMsRecent);
	}

	#flushPeriods(): void {
		this.periodMsRecent = this.#drain(this.#periodBuffer, () => this.periodMsRecent);
	}

	#drain(buffer: number[], read: () => number[]): number[] {
		// Read current value without creating a reactive dep on the flush path.
		const current = untrack(read);
		if (buffer.length === 0) return current;
		const next = current.concat(buffer);
		buffer.length = 0;
		return next.length > SAMPLE_WINDOW
			? next.slice(next.length - SAMPLE_WINDOW)
			: next;
	}

	/**
	 * Record a lifecycle event. Low-frequency — safe to touch reactive state.
	 * Updates the appropriate counter and appends to the ring buffer.
	 */
	recordEvent(kind: TelemetryKind, payload: unknown): void {
		const evt: TelemetryEvent = { t: Date.now(), kind, payload };
		const current = untrack(() => this.events);
		const next = current.concat(evt);
		this.events =
			next.length > EVENT_CAP ? next.slice(next.length - EVENT_CAP) : next;

		switch (kind) {
			case 'config_patch': this.counts.configPatches++; break;
			case 'fleet_in':     this.counts.fleetIn++;       break;
			case 'fleet_out':    this.counts.fleetOut++;      break;
			case 'error':        this.counts.errors++;        break;
		}
	}

	clear(): void {
		this.#tickBuffer.length = 0;
		this.#periodBuffer.length = 0;
		this.tickMsRecent = [];
		this.periodMsRecent = [];
		this.events = [];
		this.counts = { configPatches: 0, fleetIn: 0, fleetOut: 0, errors: 0 };
	}

	/** Force a flush of pending samples (e.g. before snapshot/export). */
	flush(): void {
		this.#flushTicks();
		this.#flushPeriods();
	}

	toJSON(): TelemetrySnapshot {
		this.flush();
		return {
			tick: {
				recent: [...this.tickMsRecent],
				p50: this.tickMsP50,
				p95: this.tickMsP95,
			},
			frame: {
				recent: [...this.periodMsRecent],
				p50: this.frameMsP50,
				p95: this.frameMsP95,
			},
			fps: this.fps,
			fpsLow: this.fpsLow,
			events: [...this.events],
			counts: { ...this.counts },
		};
	}
}
