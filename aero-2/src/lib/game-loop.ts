/**
 * Single RAF source for the kiosk. Class wrapper over the subscriber pattern.
 */

type Callback = (dt: number) => void;

export class GameLoop {
	#subscribers = new Set<Callback>();
	#errorCounts = new WeakMap<Callback, number>();
	#rafId: number | null = null;
	#lastTime = 0;

	subscribe(fn: Callback): () => void {
		this.#subscribers.add(fn);
		this.#errorCounts.set(fn, 0);
		this.#start();

		return () => {
			this.#subscribers.delete(fn);
			this.#errorCounts.delete(fn);
			if (this.#subscribers.size === 0) this.#stop();
		};
	}

	#loop = (now: number): void => {
		if (document.visibilityState === 'hidden') {
			this.#rafId = requestAnimationFrame(this.#loop);
			this.#lastTime = now;
			return;
		}

		const dt = Math.min((now - this.#lastTime) / 1000, 0.1);
		this.#lastTime = now;

		for (const fn of this.#subscribers) {
			try {
				fn(dt);
				if (this.#errorCounts.get(fn)) this.#errorCounts.set(fn, 0);
			} catch {
				const count = (this.#errorCounts.get(fn) ?? 0) + 1;
				this.#errorCounts.set(fn, count);
				if (count >= 10) {
					console.warn('[game-loop] unsubscribing failing callback');
					this.#subscribers.delete(fn);
					this.#errorCounts.delete(fn);
				}
			}
		}

		this.#rafId = requestAnimationFrame(this.#loop);
	};

	#start(): void {
		if (this.#rafId !== null) return;
		this.#lastTime = performance.now();
		this.#rafId = requestAnimationFrame(this.#loop);
	}

	#stop(): void {
		if (this.#rafId !== null) {
			cancelAnimationFrame(this.#rafId);
			this.#rafId = null;
		}
	}
}

/** Process singleton — one RAF for the kiosk page. */
export const gameLoop = new GameLoop();
