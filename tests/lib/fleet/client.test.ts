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
	setQualityMode: ReturnType<typeof vi.fn>;
	applyConfigPatch: ReturnType<typeof vi.fn>;
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
		applyConfigPatch: vi.fn(),
	} as unknown as FleetClientModel & {
		applyScene: ReturnType<typeof vi.fn>;
		scheduleFlyover: ReturnType<typeof vi.fn>;
		setQualityMode: ReturnType<typeof vi.fn>;
		applyConfigPatch: ReturnType<typeof vi.fn>;
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

// ─── set_config enum validation ─────────────────────────────────────────────
// /api/command deliberately does NOT validate payloads, so the isValid* gates
// in the client's set_config handler are the trust boundary for enum fields.

describe('set_config enum validation', () => {
	it('applies a valid weather', () => {
		command({ type: 'set_config', patch: { weather: 'rain' } });
		expect(model.applyScene).toHaveBeenCalledWith('dubai', 'rain');
	});

	it('ignores an invalid weather string instead of casting it', () => {
		command({ type: 'set_config', patch: { weather: 'hurricane' } });
		expect(model.applyScene).not.toHaveBeenCalled();
	});

	it('applies a valid qualityMode', () => {
		command({ type: 'set_config', patch: { qualityMode: 'ultra' } });
		expect(model.setQualityMode).toHaveBeenCalledWith('ultra');
	});

	it('ignores an invalid qualityMode instead of casting it', () => {
		command({ type: 'set_config', patch: { qualityMode: 'potato' } });
		expect(model.setQualityMode).not.toHaveBeenCalled();
	});
});

// ─── config_patch remote-stamp routing ──────────────────────────────────────
// Stamped fleet patches must go through model.applyConfigPatch (which records
// telemetry) carrying the CRDT stamp — not the config-tree global, which
// would bypass the telemetry recordEvent.

describe('config_patch remote-stamp routing', () => {
	function patch(msg: Record<string, unknown>): void {
		const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
		es.emit('config_patch', msg);
	}

	it('routes stamped patches through the model wrapper with the remote stamp', () => {
		patch({ path: 'atmosphere.clouds.density', value: 0.5, timestamp: 123, sourceId: 'pi-1' });
		expect(model.applyConfigPatch).toHaveBeenCalledWith(
			'atmosphere.clouds.density', 0.5, { remote: { timestamp: 123, sourceId: 'pi-1' } },
		);
	});

	it('routes unstamped patches through the model wrapper without a stamp', () => {
		patch({ path: 'world.showClouds', value: true });
		expect(model.applyConfigPatch).toHaveBeenCalledWith('world.showClouds', true);
	});
});
