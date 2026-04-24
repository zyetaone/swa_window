import { describe, it, expect, beforeEach } from 'vitest';
import { publish, subscribe, subscriberCount, type SseEvent } from '$lib/fleet/sse-bus.server';

describe('sse-bus', () => {
	// The bus is module-scope, shared across tests. Each test cleans up its
	// own subscriptions in the individual `it` body — there's no reset hook
	// exported (and we don't want one: the subscriber set IS the truth).
	beforeEach(() => {
		expect(subscriberCount()).toBe(0);
	});

	it('publish with no subscribers is a no-op', () => {
		expect(() => publish({ type: 'x', data: {} })).not.toThrow();
	});

	it('subscribe returns an unsubscribe that decrements count', () => {
		const unsubscribe = subscribe(() => {});
		expect(subscriberCount()).toBe(1);
		unsubscribe();
		expect(subscriberCount()).toBe(0);
	});

	it('publish fans out to every current subscriber', () => {
		const received: SseEvent[][] = [[], [], []];
		const unsubs = received.map((_, i) => subscribe((ev) => { received[i].push(ev); }));
		const event: SseEvent = { type: 'config_patch', data: { path: 'x.y', value: 1 } };

		publish(event);

		for (const log of received) {
			expect(log).toHaveLength(1);
			expect(log[0]).toEqual(event);
		}
		unsubs.forEach((u) => u());
	});

	it('one throwing subscriber does not block others', () => {
		const received: SseEvent[] = [];
		const unsubA = subscribe(() => { throw new Error('boom'); });
		const unsubB = subscribe((ev) => { received.push(ev); });

		const event: SseEvent = { type: 'ping', data: null };
		expect(() => publish(event)).not.toThrow();
		expect(received).toEqual([event]);

		unsubA();
		unsubB();
	});

	it('unsubscribe only removes the matching callback', () => {
		const aReceived: SseEvent[] = [];
		const bReceived: SseEvent[] = [];
		const unsubA = subscribe((ev) => { aReceived.push(ev); });
		const unsubB = subscribe((ev) => { bReceived.push(ev); });

		publish({ type: '1', data: null });
		unsubA();
		publish({ type: '2', data: null });

		expect(aReceived).toHaveLength(1);
		expect(bReceived).toHaveLength(2);

		unsubB();
	});
});
