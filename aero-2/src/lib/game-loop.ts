/**
 * Single RAF source for the kiosk.
 */

type Callback = () => void;

export class GameLoop {
	#subscribers = new Set<Callback>();
	#errorCounts = new WeakMap<Callback, number>();
	#rafId: number | null = null;

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

	#loop = (): void => {
		if (document.visibilityState === 'hidden') {
			this.#rafId = requestAnimationFrame(this.#loop);
			return;
		}

		for (const fn of this.#subscribers) {
			try {
				fn();
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
		this.#rafId = requestAnimationFrame(this.#loop);
	}

	#stop(): void {
		if (this.#rafId !== null) {
			cancelAnimationFrame(this.#rafId);
			this.#rafId = null;
		}
	}
}

export const gameLoop = new GameLoop();
