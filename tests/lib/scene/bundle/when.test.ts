import { describe, it, expect } from 'vitest';
import { evalWhen } from '$lib/scene/bundle/when';
import type { WhenPredicate } from '$lib/scene/bundle/types';
import type { AeroWindow } from '$lib/model/aero-window.svelte';

/** Minimal fake model for predicate evaluation — only the fields evalWhen reads. */
function fakeModel(overrides: Partial<Pick<AeroWindow, 'location' | 'nightFactor' | 'skyState' | 'weather'>> = {}): AeroWindow {
	return {
		location: 'dubai',
		nightFactor: 0.0,
		skyState: 'day',
		weather: 'clear',
		...overrides,
	} as AeroWindow;
}

describe('evalWhen', () => {
	it('returns true when predicate is undefined', () => {
		expect(evalWhen(undefined, fakeModel())).toBe(true);
	});

	it('returns true for an empty predicate', () => {
		expect(evalWhen({}, fakeModel())).toBe(true);
	});

	describe('location', () => {
		it('matches when current location is in the list', () => {
			const pred: WhenPredicate = { location: ['dubai', 'mumbai'] };
			expect(evalWhen(pred, fakeModel({ location: 'dubai' }))).toBe(true);
			expect(evalWhen(pred, fakeModel({ location: 'mumbai' }))).toBe(true);
		});

		it('rejects when current location is not in the list', () => {
			const pred: WhenPredicate = { location: ['dubai'] };
			expect(evalWhen(pred, fakeModel({ location: 'ocean' }))).toBe(false);
		});

		it('rejects when the list is empty', () => {
			const pred: WhenPredicate = { location: [] };
			expect(evalWhen(pred, fakeModel())).toBe(false);
		});
	});

	describe('nightFactor', () => {
		it('respects min threshold', () => {
			const pred: WhenPredicate = { nightFactor: { min: 0.3 } };
			expect(evalWhen(pred, fakeModel({ nightFactor: 0.2 }))).toBe(false);
			expect(evalWhen(pred, fakeModel({ nightFactor: 0.3 }))).toBe(true);
			expect(evalWhen(pred, fakeModel({ nightFactor: 0.9 }))).toBe(true);
		});

		it('respects max threshold', () => {
			const pred: WhenPredicate = { nightFactor: { max: 0.5 } };
			expect(evalWhen(pred, fakeModel({ nightFactor: 0 }))).toBe(true);
			expect(evalWhen(pred, fakeModel({ nightFactor: 0.5 }))).toBe(true);
			expect(evalWhen(pred, fakeModel({ nightFactor: 0.51 }))).toBe(false);
		});

		it('respects both min and max', () => {
			const pred: WhenPredicate = { nightFactor: { min: 0.3, max: 0.7 } };
			expect(evalWhen(pred, fakeModel({ nightFactor: 0.2 }))).toBe(false);
			expect(evalWhen(pred, fakeModel({ nightFactor: 0.5 }))).toBe(true);
			expect(evalWhen(pred, fakeModel({ nightFactor: 0.8 }))).toBe(false);
		});
	});

	describe('skyState', () => {
		it('matches when current sky is in the list', () => {
			const pred: WhenPredicate = { skyState: ['night', 'dusk'] };
			expect(evalWhen(pred, fakeModel({ skyState: 'night' }))).toBe(true);
			expect(evalWhen(pred, fakeModel({ skyState: 'dusk' }))).toBe(true);
			expect(evalWhen(pred, fakeModel({ skyState: 'day' }))).toBe(false);
		});
	});

	describe('weather', () => {
		it('matches when current weather is in the list', () => {
			const pred: WhenPredicate = { weather: ['storm', 'rain'] };
			expect(evalWhen(pred, fakeModel({ weather: 'storm' }))).toBe(true);
			expect(evalWhen(pred, fakeModel({ weather: 'rain' }))).toBe(true);
			expect(evalWhen(pred, fakeModel({ weather: 'clear' }))).toBe(false);
		});
	});

	describe('combined predicates', () => {
		it('requires all fields to match (AND)', () => {
			const pred: WhenPredicate = {
				location: ['himalayas'],
				nightFactor: { min: 0.3 },
				weather: ['clear'],
			};
			// All match
			expect(evalWhen(pred, fakeModel({ location: 'himalayas', nightFactor: 0.5, weather: 'clear' }))).toBe(true);
			// One fails — whole predicate fails
			expect(evalWhen(pred, fakeModel({ location: 'dubai',     nightFactor: 0.5, weather: 'clear' }))).toBe(false);
			expect(evalWhen(pred, fakeModel({ location: 'himalayas', nightFactor: 0.1, weather: 'clear' }))).toBe(false);
			expect(evalWhen(pred, fakeModel({ location: 'himalayas', nightFactor: 0.5, weather: 'storm' }))).toBe(false);
		});
	});
});
