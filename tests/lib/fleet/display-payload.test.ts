import { describe, it, expect } from 'vitest';
import {
	isAllowedMediaUrl,
	parseVideoPayload,
	parseSlideshowPayload,
	encodeSlideshowPayload,
	toAbsoluteMediaUrl,
	absolutizeMediaUrls,
	isRelativeAssetUrl,
	DEFAULT_SLIDESHOW_INTERVAL_SEC,
} from '$lib/fleet/display-payload';

describe('isAllowedMediaUrl', () => {
	it('accepts http(s) and /api/assets paths', () => {
		expect(isAllowedMediaUrl('https://cdn.example.com/v.mp4')).toBe(true);
		expect(isAllowedMediaUrl('http://192.168.1.10:5173/api/assets/ab.mp4')).toBe(true);
		expect(isAllowedMediaUrl('/api/assets/deadbeef01234567.png')).toBe(true);
	});

	it('rejects junk', () => {
		expect(isAllowedMediaUrl('javascript:alert(1)')).toBe(false);
		expect(isAllowedMediaUrl('file:///etc/passwd')).toBe(false);
		expect(isAllowedMediaUrl('/etc/passwd')).toBe(false);
		expect(isAllowedMediaUrl('')).toBe(false);
	});
});

describe('parseVideoPayload', () => {
	it('returns trimmed URL or null', () => {
		expect(parseVideoPayload('  https://x.test/a.mp4  ')).toBe('https://x.test/a.mp4');
		expect(parseVideoPayload('not-a-url')).toBeNull();
		expect(parseVideoPayload(undefined)).toBeNull();
	});
});

describe('slideshow payload', () => {
	it('round-trips urls + interval', () => {
		const wire = encodeSlideshowPayload(
			['/api/assets/a.png', 'https://x.test/b.jpg', 'bad'],
			15,
		);
		const spec = parseSlideshowPayload(wire);
		expect(spec).toEqual({
			urls: ['/api/assets/a.png', 'https://x.test/b.jpg'],
			intervalSec: 15,
		});
	});

	it('defaults interval and rejects empty', () => {
		expect(parseSlideshowPayload(JSON.stringify({ urls: [] }))).toBeNull();
		const spec = parseSlideshowPayload(JSON.stringify({ urls: ['/api/assets/x.webp'] }));
		expect(spec?.intervalSec).toBe(DEFAULT_SLIDESHOW_INTERVAL_SEC);
	});

	it('clamps interval', () => {
		const wire = encodeSlideshowPayload(['/api/assets/a.png'], 1);
		expect(parseSlideshowPayload(wire)?.intervalSec).toBe(3);
	});
});

describe('toAbsoluteMediaUrl', () => {
	const origin = 'http://aero-display-00.local:5173';

	it('rewrites /api/assets paths against admin origin', () => {
		expect(toAbsoluteMediaUrl('/api/assets/deadbeef.png', origin)).toBe(
			'http://aero-display-00.local:5173/api/assets/deadbeef.png',
		);
	});

	it('leaves absolute URLs alone', () => {
		expect(toAbsoluteMediaUrl('https://cdn.example.com/v.mp4', origin)).toBe(
			'https://cdn.example.com/v.mp4',
		);
	});

	it('absolutizeMediaUrls maps a list', () => {
		expect(
			absolutizeMediaUrls(['/api/assets/a.png', 'https://x.test/b.jpg'], origin),
		).toEqual([
			'http://aero-display-00.local:5173/api/assets/a.png',
			'https://x.test/b.jpg',
		]);
	});

	it('isRelativeAssetUrl detects local asset paths', () => {
		expect(isRelativeAssetUrl('/api/assets/x.png')).toBe(true);
		expect(isRelativeAssetUrl('https://cdn.example.com/x.png')).toBe(false);
	});
});
