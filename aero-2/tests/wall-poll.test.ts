import { describe, it, expect, vi } from 'vitest';
import { createWallPoller } from '#lib/settings/wall-poll.js';
import { WallSync } from '#lib/settings/wall.svelte.js';
import { createSettings } from '#lib/settings/settings.svelte.js';

const snapshot = (version: number) => ({
	version,
	applyAtWallSec: 100,
	state: {
		placeId: 'denver',
		presetId: '',
		weather: 'rain',
		clockOffsetH: 0,
		displayMode: 'flight',
		blindOpen: true,
		rotate: true,
		mediaUrls: []
	}
});

const ok = (version: number, etag = `W/"${version}"`) =>
	new Response(JSON.stringify(snapshot(version)), {
		status: 200,
		headers: { etag, 'content-type': 'application/json' }
	});

describe('createWallPoller', () => {
	it('buffers what it fetches and applies nothing', async () => {
		const sync = new WallSync();
		const config = createSettings();
		const before = config.weather;
		const poller = createWallPoller(sync, '', async () => ok(1));

		await poller.poll();
		poller.stop();

		expect(sync.pending?.version).toBe(1);
		expect(config.weather).toBe(before);
	});

	it('sends the previous ETag and does nothing with a 304', async () => {
		const sync = new WallSync();
		const seen: (string | null)[] = [];
		const poller = createWallPoller(sync, '', async (_url, init) => {
			seen.push(new Headers(init?.headers).get('if-none-match'));
			return seen.length === 1 ? ok(1) : new Response(null, { status: 304 });
		});

		await poller.poll();
		sync.applyDue(100, createSettings());
		await poller.poll();
		poller.stop();

		expect(seen).toEqual([null, 'W/"1"']);
		expect(sync.pending).toBeNull();
	});

	/**
	 * On a loaded Pi a response can outlast the 2 s interval. Without a guard the
	 * second poll sends the ETag the first has not written yet, gets a full 200
	 * it did not need, and they stack from there.
	 */
	it('runs one request at a time', async () => {
		let release: () => void = () => {};
		let calls = 0;
		const gate = new Promise<void>((r) => (release = r));
		const poller = createWallPoller(new WallSync(), '', async () => {
			calls++;
			await gate;
			return ok(1);
		});

		const first = poller.poll();
		await poller.poll();
		expect(calls).toBe(1);

		release();
		await first;
		poller.stop();
	});

	/**
	 * A pane that cannot reach the wall origin keeps running on what it has.
	 * The alternative is a network error on a kiosk screen in a client's lobby.
	 */
	it('survives a rejected fetch, a 500 and unparseable JSON', async () => {
		const sync = new WallSync();
		const responses: (() => Promise<Response>)[] = [
			() => Promise.reject(new Error('ECONNREFUSED')),
			async () => new Response('nope', { status: 500 }),
			async () => new Response('{not json', { status: 200, headers: { etag: 'W/"9"' } })
		];
		let i = 0;
		const poller = createWallPoller(sync, '', () => responses[i++]());

		for (let n = 0; n < 3; n++) await expect(poller.poll()).resolves.toBeUndefined();
		poller.stop();
		expect(sync.pending).toBeNull();
	});

	it('polls the configured origin, not just its own', async () => {
		const urls: string[] = [];
		const poller = createWallPoller(new WallSync(), 'http://aero-1.local:3000', async (url) => {
			urls.push(String(url));
			return ok(1);
		});
		await poller.poll();
		poller.stop();
		expect(urls[0]).toBe('http://aero-1.local:3000/api/wall');
	});

	it('stops polling after stop()', async () => {
		vi.useFakeTimers();
		try {
			const fetchImpl = vi.fn(async () => ok(1));
			const poller = createWallPoller(new WallSync(), '', fetchImpl);
			poller.stop();
			await vi.advanceTimersByTimeAsync(10_000);
			expect(fetchImpl).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
