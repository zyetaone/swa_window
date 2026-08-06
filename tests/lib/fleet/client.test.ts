/**
 * DeviceClient — corridor group gating on leader broadcasts.
 *
 * Two 3-pane corridors share one LAN; each corridor's leader fans out
 * director_decision / vantage_beat to every discovered peer. Without gating,
 * EITHER leader would drive ALL panes. The client must apply only broadcasts
 * whose groupId matches the local binding (resolveBinding), treating an
 * absent groupId as a legacy unscoped broadcast (apply — back-compat).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeviceClient } from '$lib/fleet/client.svelte';
import type { FleetClientModel } from '$lib/fleet/protocol';

// ─── EventSource / fetch stubs ──────────────────────────────────────────────

type Listener = (ev: { data: string }) => void;

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	#listeners = new Map<string, Listener[]>();
	closed = false;
	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}
	addEventListener(type: string, fn: Listener): void {
		const arr = this.#listeners.get(type) ?? [];
		arr.push(fn);
		this.#listeners.set(type, arr);
	}
	close(): void {
		this.closed = true;
	}
	emit(type: string, payload: unknown): void {
		for (const fn of this.#listeners.get(type) ?? []) {
			fn({ data: JSON.stringify(payload) });
		}
	}
}

function makeModel(): FleetClientModel & {
	applyScene: ReturnType<typeof vi.fn>;
	scheduleFlyover: ReturnType<typeof vi.fn>;
} {
	return {
		measuredFps: 60,
		displayMode: 'flight',
		location: 'dubai',
		weather: 'clear',
		qualityMode: 'balanced',
		syncToRealTime: false,
		applyScene: vi.fn(),
		scheduleFlyover: vi.fn(),
		setDisplayMode: vi.fn(),
		setQualityMode: vi.fn(),
		setAltitude: vi.fn(),
		setTime: vi.fn(),
		setFlightSpeed: vi.fn(),
	} as unknown as FleetClientModel & {
		applyScene: ReturnType<typeof vi.fn>;
		scheduleFlyover: ReturnType<typeof vi.fn>;
	};
}

// ─── Setup ──────────────────────────────────────────────────────────────────

let client: DeviceClient;
let model: ReturnType<typeof makeModel>;

function bind(groupId: string): void {
	localStorage.setItem('aero.device.binding', JSON.stringify({ role: 'left', groupId }));
}

function command(msg: Record<string, unknown>): void {
	const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
	es.emit('command', msg);
}

beforeEach(() => {
	localStorage.clear();
	FakeEventSource.instances = [];
	vi.stubGlobal('EventSource', FakeEventSource);
	// No network in tests: heartbeats + peer refresh are best-effort and
	// swallow rejections internally.
	vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
	bind('corridor1');
	model = makeModel();
	client = new DeviceClient(model);
});

afterEach(() => {
	client.destroy();
	vi.unstubAllGlobals();
	localStorage.clear();
});

// ─── director_decision gating ───────────────────────────────────────────────

describe('director_decision corridor gating', () => {
	// transitionAtMs in the past → immediate-apply path (no timer to await).
	const decision = (groupId?: string) => ({
		v: 2,
		type: 'director_decision',
		locationId: 'mumbai',
		transitionAtMs: Date.now() - 100,
		...(groupId !== undefined ? { groupId } : {}),
	});

	it('applies when the message groupId matches my binding', () => {
		command(decision('corridor1'));
		expect(model.applyScene).toHaveBeenCalledWith('mumbai', undefined);
	});

	it('ignores when the message targets a different corridor', () => {
		command(decision('corridor2'));
		expect(model.applyScene).not.toHaveBeenCalled();
	});

	it('applies when the message carries no groupId (legacy leader)', () => {
		command(decision());
		expect(model.applyScene).toHaveBeenCalledWith('mumbai', undefined);
	});
});

// ─── vantage_beat gating ────────────────────────────────────────────────────

describe('vantage_beat corridor gating', () => {
	const beat = (groupId?: string) => ({
		v: 2,
		type: 'vantage_beat',
		transitionAtMs: Date.now() + 2500,
		durationMs: 8000,
		pitchDeg: -18,
		altitudeFt: 12000,
		...(groupId !== undefined ? { groupId } : {}),
	});

	it('schedules the flyover when the groupId matches', () => {
		command(beat('corridor1'));
		expect(model.scheduleFlyover).toHaveBeenCalledOnce();
	});

	it('ignores a flyover targeted at a different corridor', () => {
		command(beat('corridor2'));
		expect(model.scheduleFlyover).not.toHaveBeenCalled();
	});

	it('schedules when the message carries no groupId (legacy leader)', () => {
		command(beat());
		expect(model.scheduleFlyover).toHaveBeenCalledOnce();
	});
});
