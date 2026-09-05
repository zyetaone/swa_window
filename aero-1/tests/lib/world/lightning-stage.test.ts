/**
 * lightning-stage lifecycle — mount-race liveness and session reset.
 *
 * The kiosk remounts the Cesium viewer on auto-retry / HMR / page nav, and
 * CesiumViewer.onDestroy can fire while CesiumManager.start() is suspended
 * in an await. These tests pin the two failure modes of that race:
 *
 *  1. mountLightning must not latch a stage onto a destroyed viewer — a
 *     bare `if (_stage) return` guard would then keep every later LIVE mount
 *     out for the rest of the session.
 *  2. destroyLightning must reset _stormIndex, or the post-remount session's
 *     storms silently shift character (seeded by daySeed ^ stormIndex).
 */
import { describe, it, expect, afterEach } from 'vitest';
import type * as CesiumType from 'cesium';
import {
	mountLightning,
	tickLightning,
	destroyLightning,
} from '$lib/world/lightning-stage';

interface FakeStage {
	name: string;
	enabled: boolean;
	uniforms: Record<string, () => number>;
}

function fakeCesium() {
	return {
		PostProcessStage: class {
			name: string;
			enabled = true;
			uniforms: Record<string, () => number>;
			constructor(opts: { name: string; uniforms: Record<string, () => number> }) {
				this.name = opts.name;
				this.uniforms = opts.uniforms;
			}
		},
	} as unknown as typeof CesiumType;
}

interface FakeViewer {
	destroyed: boolean;
	stages: FakeStage[];
	isDestroyed(): boolean;
	scene: {
		postProcessStages: {
			add(s: FakeStage): void;
			remove(s: FakeStage): void;
		};
	};
}

function fakeViewer(): FakeViewer {
	const stages: FakeStage[] = [];
	return {
		destroyed: false,
		stages,
		scene: {
			postProcessStages: {
				add: (s) => { stages.push(s); },
				remove: (s) => { stages.splice(stages.indexOf(s), 1); },
			},
		},
		isDestroyed() { return this.destroyed; },
	};
}

const STORM = {
	hasLightning: true,
	lightningDecayRate: 0.4,
	lightningMinInterval: 2,
	lightningMaxInterval: 9,
};

/** Mount on a fresh viewer and record the flash sequence of one storm. */
function stormFlashSequence(ticks = 120, delta = 5): number[] {
	const v = fakeViewer();
	mountLightning(fakeCesium(), v as unknown as CesiumType.Viewer);
	// false→true transition on hasLightning → beginStorm(_stormIndex).
	tickLightning(0.016, STORM);
	const out: number[] = [];
	for (let i = 0; i < ticks; i++) {
		tickLightning(delta, STORM);
		out.push(v.stages[0].uniforms.u_flash());
	}
	return out;
}

describe('mountLightning liveness', () => {
	afterEach(() => destroyLightning());

	it('is idempotent on a live viewer', () => {
		const v = fakeViewer();
		mountLightning(fakeCesium(), v as unknown as CesiumType.Viewer);
		mountLightning(fakeCesium(), v as unknown as CesiumType.Viewer);
		expect(v.stages).toHaveLength(1);
	});

	it('does not latch a stage when start() resumes on a destroyed viewer', () => {
		const v1 = fakeViewer();
		mountLightning(fakeCesium(), v1 as unknown as CesiumType.Viewer);
		expect(v1.stages).toHaveLength(1);

		// onDestroy fires while start() is suspended: destroy() runs first.
		// (destroyLightning skips scene removal on a dead viewer, so the stale
		// stage entry stays in v1 — only the module latch is cleared.)
		v1.destroyed = true;
		destroyLightning();

		// start() resumes and calls mountLightning on the destroyed viewer.
		mountLightning(fakeCesium(), v1 as unknown as CesiumType.Viewer);
		expect(v1.stages).toHaveLength(1); // nothing new added

		// The next LIVE mount must succeed — the race must not bar it.
		const v2 = fakeViewer();
		mountLightning(fakeCesium(), v2 as unknown as CesiumType.Viewer);
		expect(v2.stages).toHaveLength(1);
	});

	it('remounts when the latched stage belongs to a destroyed viewer', () => {
		const v1 = fakeViewer();
		mountLightning(fakeCesium(), v1 as unknown as CesiumType.Viewer);
		v1.destroyed = true; // viewer died without destroyLightning

		const v2 = fakeViewer();
		mountLightning(fakeCesium(), v2 as unknown as CesiumType.Viewer);
		expect(v2.stages).toHaveLength(1);
	});
});

describe('destroyLightning', () => {
	afterEach(() => destroyLightning());

	it('resets _stormIndex so a remounted session replays the same storm', () => {
		const first = stormFlashSequence();
		destroyLightning();
		const second = stormFlashSequence();
		// A strike must actually have fired, or the comparison is vacuous.
		expect(first.some((f) => f > 0)).toBe(true);
		expect(second).toEqual(first);
	});
});
