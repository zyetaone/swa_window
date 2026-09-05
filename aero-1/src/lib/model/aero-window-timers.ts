/**
 * Scene timers for AeroWindow — the flyover beat and the lock-step cruise.
 *
 * Both exist for the same reason: three panes must change at the SAME
 * wall-clock instant or the panorama tears at the seams. The leader schedules
 * from its tick, every follower schedules from the fleet client's handler with
 * the identical `transitionAtMs`, and both arrive together.
 *
 * Split out of the class because timers are the one kind of state that leaks
 * when nobody owns it. They were previously two independent collections and
 * three teardown call sites in an 800-line file, so "did every path cancel
 * everything?" could only be answered by reading all of it. Here it is one
 * object with one `destroy()`.
 *
 * The class keeps `$state` ownership — this module never touches reactive
 * fields directly. Route stamping writes `$state`, so it arrives as a host
 * callback rather than being reimplemented here.
 */
import type { LocationId, VantageBeat, SkyState } from '$lib/types';
import { transitionDelayMs } from '$lib/fleet/protocol';

/** What the timers need from the model. Narrow on purpose. */
export interface SceneTimerHost {
	readonly skyState: SkyState;
	readonly config: { camera: { altitude: { min: number } } };
	readonly flight: {
		setFlyoverAltitude(ft: number): void;
		clearFlyoverAltitude(): void;
		flyTo(locationId: LocationId, skyState: SkyState): void;
	};
	applyConfigPatch(path: string, value: unknown): boolean;
	/** Record origin → destination for the passenger blind watermark. */
	stampRoute(toId: LocationId): void;
}

export class SceneTimers {
	/**
	 * Flyover uses a SET because a beat is two chained timers (enter, then exit
	 * scheduled from inside enter), and both must be cancellable at any point.
	 */
	#flyoverTimers = new Set<ReturnType<typeof setTimeout>>();

	/**
	 * The cruise uses a single SLOT, not a set: any newer scene change
	 * supersedes a pending one, so there is never more than one in flight.
	 */
	#pendingFlyTo: ReturnType<typeof setTimeout> | null = null;

	/**
	 * A THUNK, not the host itself. The model constructs SceneTimers as a field
	 * initializer, so passing `this` directly would capture a half-built object
	 * and depend on declaration order; and an object literal of getters cannot
	 * see the instance at all (`this` inside them is the literal). Resolving
	 * lazily sidesteps both, and costs one call per timer edge.
	 */
	readonly #getHost: () => SceneTimerHost;

	constructor(getHost: () => SceneTimerHost) {
		this.#getHost = getHost;
	}

	get #host(): SceneTimerHost {
		return this.#getHost();
	}

	// ── Night-city flyover beat ──────────────────────────────────────────────

	/** Atomic enter edge. CRDT-stamped so peer Pis see the flyover. */
	enterFlyover(pitchDeg: number, altitudeFt: number): void {
		this.#host.applyConfigPatch('camera.flyoverPitchDeg', pitchDeg);
		this.#host.flight.setFlyoverAltitude(
			Math.max(altitudeFt, this.#host.config.camera.altitude.min),
		);
	}

	/** Atomic exit edge — also the cancel path for a beat still pending. */
	exitFlyover(): void {
		for (const id of this.#flyoverTimers) clearTimeout(id);
		this.#flyoverTimers.clear();
		this.#host.applyConfigPatch('camera.flyoverPitchDeg', 0);
		this.#host.flight.clearFlyoverAltitude();
	}

	/**
	 * Schedule enter@transitionAtMs and exit@+durationMs, both locked to the
	 * shared instant so every pane pitches down and pops back together.
	 * Cancels any beat already pending.
	 */
	scheduleFlyover(beat: VantageBeat, transitionAtMs: number): void {
		this.exitFlyover();
		// Clamped for the same reason as director_decision: a peer with a bad
		// clock must not freeze the beat for hours, nor overflow setTimeout's
		// 32-bit delay into firing instantly.
		const enterId = setTimeout(() => {
			this.#flyoverTimers.delete(enterId);
			this.enterFlyover(beat.pitchDeg, beat.altitudeFt);
			const exitId = setTimeout(() => {
				this.#flyoverTimers.delete(exitId);
				this.exitFlyover();
			}, beat.durationMs);
			this.#flyoverTimers.add(exitId);
		}, transitionDelayMs(transitionAtMs));
		this.#flyoverTimers.add(enterId);
	}

	// ── Scheduled cruise (fleet lock-step) ───────────────────────────────────

	/**
	 * Start the local flyTo at the shared transitionAtMs — the leader side of
	 * the director_decision contract, mirroring how the fleet client schedules
	 * applyScene on followers.
	 *
	 * Starting immediately instead left the leader's blinds reopening
	 * ~TRANSITION_DELAY_MS ahead of the edge panes: exactly the tear the
	 * schedule exists to prevent.
	 */
	scheduleFlyTo(locationId: LocationId, transitionAtMs: number): void {
		this.cancelScheduledFlyTo();
		// Stamp at SCHEDULE time, not on arrival, so a closed blind reads
		// From → To during the lock-step wait rather than staying blank until
		// the cruise engines start.
		this.#host.stampRoute(locationId);
		const id = setTimeout(() => {
			this.#pendingFlyTo = null;
			this.#host.flight.flyTo(locationId, this.#host.skyState);
		}, transitionDelayMs(transitionAtMs));
		this.#pendingFlyTo = id;
	}

	cancelScheduledFlyTo(): void {
		if (this.#pendingFlyTo !== null) {
			clearTimeout(this.#pendingFlyTo);
			this.#pendingFlyTo = null;
		}
	}

	/** True while a lock-step cruise is waiting. Exposed for tests. */
	get hasPendingFlyTo(): boolean {
		return this.#pendingFlyTo !== null;
	}

	/** True while a flyover beat has an edge still to fire. Exposed for tests. */
	get pendingFlyoverCount(): number {
		return this.#flyoverTimers.size;
	}

	/**
	 * Cancel everything. The single teardown the split exists to provide — a
	 * timer that survives its model calls into a destroyed scene.
	 *
	 * Note this deliberately does NOT run the exit edge's config writes: on
	 * destroy there is nothing left to write to, and `exitFlyover()` would
	 * patch config on a model being torn down.
	 */
	destroy(): void {
		for (const id of this.#flyoverTimers) clearTimeout(id);
		this.#flyoverTimers.clear();
		this.cancelScheduledFlyTo();
	}
}
