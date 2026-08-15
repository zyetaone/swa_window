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
	setWeather: ReturnType<typeof vi.fn>;
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
		setWeather: vi.fn(),
		scheduleFlyover: vi.fn(),
		setDisplayMode: vi.fn(),
		setQualityMode: vi.fn(),
		setAltitude: vi.fn(),
		setTime: vi.fn(),
		setFlightSpeed: vi.fn(),
		applyConfigPatch: vi.fn(),
	} as unknown as FleetClientModel & {
		applyScene: ReturnType<typeof vi.fn>;
		setWeather: ReturnType<typeof vi.fn>;
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
	it('changes weather in place — never via applyScene, which would fake a cruise', () => {
		command({ type: 'set_config', patch: { weather: 'rain' } });
		expect(model.setWeather).toHaveBeenCalledWith('rain', { trackUserOverride: false });
		// The regression this pins: applyScene flyTo()s its target, and the
		// target here is the CURRENT location — so routing weather through it
		// made every leader weather roll run the edge panes through a bogus
		// cruise (blinds close, warp, reopen) with nowhere to go.
		expect(model.applyScene).not.toHaveBeenCalled();
	});

	it('ignores an invalid weather string instead of casting it', () => {
		command({ type: 'set_config', patch: { weather: 'hurricane' } });
		expect(model.setWeather).not.toHaveBeenCalled();
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

// ─── ambient jitter fan-out ─────────────────────────────────────────────────
// The panorama leader re-rolls clouds/haze every 3-8 min (tickRandomize) and
// followers never run that code, so these three values must arrive over the
// wire or the 3-screen wall drifts apart between location changes.

describe('set_config ambient jitter (leader → followers)', () => {
	it('applies all three ambient values the leader rolls together', () => {
		command({ type: 'set_config', patch: { cloudDensity: 0.42, cloudSpeed: 0.8, hazeAmount: 0.07 } });
		expect(model.applyConfigPatch).toHaveBeenCalledWith('atmosphere.clouds.density', 0.42);
		expect(model.applyConfigPatch).toHaveBeenCalledWith('atmosphere.clouds.speed', 0.8);
		expect(model.applyConfigPatch).toHaveBeenCalledWith('atmosphere.haze.amount', 0.07);
	});

	it('clamps out-of-range values — /api/command does not validate payloads', () => {
		command({ type: 'set_config', patch: { cloudSpeed: 99, hazeAmount: -5 } });
		expect(model.applyConfigPatch).toHaveBeenCalledWith('atmosphere.clouds.speed', 3);
		expect(model.applyConfigPatch).toHaveBeenCalledWith('atmosphere.haze.amount', 0);
	});

	it('ignores non-numeric ambient fields rather than writing NaN into the scene', () => {
		command({ type: 'set_config', patch: { cloudSpeed: 'fast', hazeAmount: null } });
		expect(model.applyConfigPatch).not.toHaveBeenCalledWith('atmosphere.clouds.speed', expect.anything());
		expect(model.applyConfigPatch).not.toHaveBeenCalledWith('atmosphere.haze.amount', expect.anything());
	});

	// The leader stamps groupId on its ambient set_config, so the same corridor
	// gating that protects director_decision/vantage_beat must cover it — with
	// two corridors on one LAN, corridor A's leader would otherwise repaint
	// corridor B's sky.
	it('ignores an ambient push aimed at a different corridor', () => {
		command({ type: 'set_config', groupId: 'corridor2', patch: { cloudDensity: 0.9 } });
		expect(model.applyConfigPatch).not.toHaveBeenCalledWith('atmosphere.clouds.density', 0.9);
	});

	it('applies an ambient push for its own corridor', () => {
		command({ type: 'set_config', groupId: 'corridor1', patch: { cloudDensity: 0.9 } });
		expect(model.applyConfigPatch).toHaveBeenCalledWith('atmosphere.clouds.density', 0.9);
	});

	it('still applies an unscoped push — admin set_config carries no groupId', () => {
		command({ type: 'set_config', patch: { cloudDensity: 0.7 } });
		expect(model.applyConfigPatch).toHaveBeenCalledWith('atmosphere.clouds.density', 0.7);
	});
});

// ─── apply-ack recording ────────────────────────────────────────────────────
// The client records a pushed commandId on the model AFTER applying, so the
// next /api/status heartbeat proves the kiosk applied the message (a 200 from
// /api/command only proves it reached the SSE bus). Replays re-ack the same
// id — harmless; it's the same command.

describe('apply-ack recording', () => {
	function patch(msg: Record<string, unknown>): void {
		const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
		es.emit('config_patch', msg);
	}

	it('records the commandId after applying a set_scene command', () => {
		command({ type: 'set_scene', location: 'mumbai', commandId: 'cmd-scene-1' });
		expect(model.applyScene).toHaveBeenCalledWith('mumbai', undefined);
		expect(model.lastAppliedCommandId).toBe('cmd-scene-1');
	});

	it('records the commandId after applying a set_mode command', () => {
		command({ type: 'set_mode', mode: 'video', payload: 'https://x.test/v.mp4', commandId: 'cmd-mode-1' });
		expect(model.setDisplayMode).toHaveBeenCalled();
		expect(model.lastAppliedCommandId).toBe('cmd-mode-1');
	});

	it('does not ack set_mode when setDisplayMode returns false (rejected payload / LWW)', () => {
		model.setDisplayMode = vi.fn().mockReturnValue(false);
		command({ type: 'set_mode', mode: 'video', payload: 'https://x.test/v.mp4', commandId: 'cmd-mode-fail' });
		expect(model.lastAppliedCommandId).toBeUndefined();
	});

	it('records the commandId after applying a set_config command', () => {
		command({ type: 'set_config', patch: { cloudDensity: 0.5 }, commandId: 'cmd-cfg-1' });
		expect(model.lastAppliedCommandId).toBe('cmd-cfg-1');
	});

	it('does not ack set_config when no field was applied', () => {
		command({ type: 'set_config', patch: { notAField: true }, commandId: 'cmd-cfg-empty' });
		expect(model.lastAppliedCommandId).toBeUndefined();
	});

	it('records the commandId after applying a config_patch event', () => {
		patch({ path: 'world.showClouds', value: true, commandId: 'cmd-patch-1' });
		expect(model.lastAppliedCommandId).toBe('cmd-patch-1');
	});

	it('does not ack a command gated to a different corridor (never applied)', () => {
		command({ type: 'set_config', groupId: 'corridor2', patch: { cloudDensity: 0.9 }, commandId: 'cmd-x' });
		expect(model.lastAppliedCommandId).toBeUndefined();
	});

	it('does not ack an invalid set_scene (nothing was applied)', () => {
		command({ type: 'set_scene', location: 'atlantis', commandId: 'cmd-bad' });
		expect(model.applyScene).not.toHaveBeenCalled();
		expect(model.lastAppliedCommandId).toBeUndefined();
	});

	it('ignores non-string commandIds rather than recording junk', () => {
		command({ type: 'set_scene', location: 'mumbai', commandId: 42 });
		expect(model.lastAppliedCommandId).toBeUndefined();
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

// ─── scene_resync ───────────────────────────────────────────────────────────

describe('scene_resync recovers a pane that rebooted mid-day', () => {
	// The gap this closes: boot is deterministic (pickDailyShow) and the SSE
	// replay buffer covers a browser reload, but that buffer lives in the Pi's
	// OWN server process — so a Pi reboot returns with an empty one and the
	// pane sits on the rotation show until the director next hops.
	const resync = (locationId: string) => ({
		v: 2,
		type: 'scene_resync',
		locationId,
		weather: 'clear',
		decidedAtMs: Date.now(),
		groupId: 'corridor1',
	});

	it('flies a stale pane to where the wall actually is', () => {
		// Stub model reports location 'dubai'; the wall has moved on.
		command(resync('mumbai'));
		expect(model.applyScene).toHaveBeenCalledWith('mumbai', 'clear');
	});

	it('is a NO-OP for a pane already showing that location', () => {
		// This guard is the whole safety argument. applyScene() calls
		// exitFlyover() and #stampRoute() BEFORE it reaches flight.flyTo's own
		// early-return, so an unguarded resync would silently kill an
		// in-progress vantage beat on a perfectly healthy pane.
		command(resync('dubai'));
		expect(model.applyScene).not.toHaveBeenCalled();
	});

	it('ignores an unknown location rather than flying nowhere', () => {
		command(resync('atlantis'));
		expect(model.applyScene).not.toHaveBeenCalled();
	});

	it('respects corridor gating like every other leader broadcast', () => {
		// Two corridors on one LAN: a resync from the other corridor's leader
		// must not drag this pane out of its own group's scene.
		command({ ...resync('mumbai'), groupId: 'corridor2' });
		expect(model.applyScene).not.toHaveBeenCalled();
	});
});
