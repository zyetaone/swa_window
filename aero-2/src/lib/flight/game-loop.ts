/**
 * GameLoop — single requestAnimationFrame driver for the window.
 */

type LoopSubscriber = (nowSec: number) => void;

class GameLoop {
	#subscribers = new Set<LoopSubscriber>();
	#rafId: number | null = null;

	subscribe(fn: LoopSubscriber): () => void {
		this.#subscribers.add(fn);
		if (this.#subscribers.size === 1) {
			this.#start();
		}
		return () => {
			this.#subscribers.delete(fn);
			if (this.#subscribers.size === 0) {
				this.#stop();
			}
		};
	}

	#tick = (timestamp: number) => {
		const nowSec = timestamp / 1000;
		for (const fn of this.#subscribers) {
			fn(nowSec);
		}
		if (this.#subscribers.size > 0) {
			this.#rafId = requestAnimationFrame(this.#tick);
		}
	};

	#start() {
		if (typeof window !== 'undefined' && this.#rafId === null) {
			this.#rafId = requestAnimationFrame(this.#tick);
		}
	}

	#stop() {
		if (typeof window !== 'undefined' && this.#rafId !== null) {
			cancelAnimationFrame(this.#rafId);
			this.#rafId = null;
		}
	}
}

export const gameLoop = new GameLoop();
