import { describe, it, expect } from 'vitest';
import { createEffectFromBundle, isContentBundle } from '$lib/scene/bundle/loader';
import type { VideoBgBundle, SpriteBundle } from '$lib/scene/bundle/types';

describe('isContentBundle', () => {
	it('accepts a well-formed bundle', () => {
		const bundle: VideoBgBundle = {
			id: 'demo-video',
			type: 'video-bg',
			kind: 'atmo',
			z: 0.5,
			asset: '/videos/demo.mp4',
		};
		expect(isContentBundle(bundle)).toBe(true);
	});

	it('rejects null and primitives', () => {
		expect(isContentBundle(null)).toBe(false);
		expect(isContentBundle(undefined)).toBe(false);
		expect(isContentBundle(42)).toBe(false);
		expect(isContentBundle('bundle')).toBe(false);
	});

	it('rejects missing id', () => {
		expect(isContentBundle({ type: 'video-bg', kind: 'atmo', z: 0 })).toBe(false);
	});

	it('rejects empty id', () => {
		expect(isContentBundle({ id: '', type: 'video-bg', kind: 'atmo', z: 0 })).toBe(false);
	});

	it('rejects missing type', () => {
		expect(isContentBundle({ id: 'x', kind: 'atmo', z: 0 })).toBe(false);
	});

	it('rejects non-numeric z', () => {
		expect(isContentBundle({ id: 'x', type: 'video-bg', kind: 'atmo', z: '0' })).toBe(false);
	});
});

describe('createEffectFromBundle', () => {
	it('produces a valid Effect from a video-bg bundle', () => {
		const bundle: VideoBgBundle = {
			id: 'aurora-loop',
			type: 'video-bg',
			kind: 'atmo',
			z: 0.5,
			asset: '/videos/aurora.mp4',
			opacity: 0.8,
			when: { location: ['himalayas'], nightFactor: { min: 0.3 } },
		};
		const effect = createEffectFromBundle(bundle);
		expect(effect).not.toBeNull();
		expect(effect!.id).toBe('aurora-loop');
		expect(effect!.kind).toBe('atmo');
		expect(effect!.z).toBe(0.5);
		expect(effect!.when).toBeTypeOf('function');
		expect(effect!.component).toBeDefined();
	});

	it('carries VideoBgParams through to params', () => {
		const bundle: VideoBgBundle = {
			id: 'b',
			type: 'video-bg',
			kind: 'atmo',
			z: 0,
			asset: '/v.mp4',
			fit: 'contain',
			opacity: 0.5,
			blend: 'screen',
		};
		const effect = createEffectFromBundle(bundle);
		expect(effect!.params).toEqual({
			asset: '/v.mp4',
			fit: 'contain',
			opacity: 0.5,
			blend: 'screen',
		});
	});

	it('produces a valid Effect from a sprite bundle', () => {
		const bundle: SpriteBundle = {
			id: 'santa-2026',
			type: 'sprite',
			kind: 'geo',
			z: 5,
			image: '/api/assets/santa.png',
			lat: 25.2,
			lon: 55.3,
			altitude: 12000,
			width: 64,
			height: 32,
		};
		const effect = createEffectFromBundle(bundle);
		expect(effect).not.toBeNull();
		expect(effect!.id).toBe('santa-2026');
		expect(effect!.kind).toBe('geo');
		expect(effect!.params).toEqual({
			image: '/api/assets/santa.png',
			lat: 25.2,
			lon: 55.3,
			altitude: 12000,
			width: 64,
			height: 32,
		});
	});

	it('when predicate reflects the bundle specification', () => {
		const bundle: VideoBgBundle = {
			id: 'b',
			type: 'video-bg',
			kind: 'atmo',
			z: 0,
			asset: '/v.mp4',
			when: { location: ['dubai'] },
		};
		const effect = createEffectFromBundle(bundle)!;
		// Model stand-in with only the fields evalWhen reads
		const inLocation = { location: 'dubai', nightFactor: 0, skyState: 'day', weather: 'clear' } as never;
		const outLocation = { location: 'ocean', nightFactor: 0, skyState: 'day', weather: 'clear' } as never;
		expect(effect.when!(inLocation)).toBe(true);
		expect(effect.when!(outLocation)).toBe(false);
	});
});
