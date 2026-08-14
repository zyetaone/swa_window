import { describe, it, expect } from 'vitest';
import {
	isAllowedMediaUrl,
	parseVideoPayload,
	parseSlideshowPayload,
	encodeSlideshowPayload,
	toAbsoluteMediaUrl,
	absolutizeMediaUrls,
	isRelativeAssetUrl,
	setModePayloadError,
	MAX_SLIDESHOW_URLS,
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

	it('caps urls on parse to MAX_SLIDESHOW_URLS (encode already does)', () => {
		const many = Array.from({ length: MAX_SLIDESHOW_URLS + 5 }, (_, i) =>
			`https://cdn.example.com/${i}.png`,
		);
		const spec = parseSlideshowPayload(JSON.stringify({ urls: many }));
		expect(spec?.urls).toHaveLength(MAX_SLIDESHOW_URLS);
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

describe('setModePayloadError', () => {
	it('rejects empty slideshow and too many urls', () => {
		expect(setModePayloadError('screensaver', [])).toMatch(/at least one/i);
		const many = Array.from({ length: MAX_SLIDESHOW_URLS + 1 }, (_, i) =>
			`https://cdn.example.com/${i}.png`,
		);
		expect(setModePayloadError('screensaver', many)).toMatch(/too many/i);
	});

	it('accepts a modest valid slideshow', () => {
		expect(
			setModePayloadError('screensaver', ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'], 12),
		).toBeNull();
	});

	it('rejects missing video url', () => {
		expect(setModePayloadError('video', '')).toMatch(/video URL/i);
		expect(setModePayloadError('video', 'https://cdn.example.com/v.mp4')).toBeNull();
	});
});

