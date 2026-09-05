import { describe, it, expect, beforeEach } from 'vitest';
import {
	saveDisplayMode,
	loadDisplayMode,
	peekDisplayModeSavedAt,
	DISPLAY_MODE_STORAGE_KEY,
} from '$lib/fleet/display-mode-persist';
import { encodeSlideshowPayload } from '$lib/fleet/display-payload';

describe('display-mode-persist', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('round-trips flight (clears media) with savedAt', () => {
		saveDisplayMode('video', 'https://cdn.example.com/a.mp4', 1000);
		saveDisplayMode('flight', undefined, 2000);
		expect(loadDisplayMode()).toEqual({ mode: 'flight', savedAt: 2000 });
		expect(peekDisplayModeSavedAt()).toBe(2000);
	});

	it('round-trips video URL with savedAt', () => {
		saveDisplayMode('video', 'https://cdn.example.com/a.mp4', 12345);
		expect(loadDisplayMode()).toEqual({
			mode: 'video',
			payload: 'https://cdn.example.com/a.mp4',
			savedAt: 12345,
		});
	});

	it('round-trips slideshow payload', () => {
		const payload = encodeSlideshowPayload(['https://x.test/a.png', 'https://x.test/b.jpg'], 20);
		saveDisplayMode('screensaver', payload, 99);
		expect(loadDisplayMode()).toEqual({ mode: 'screensaver', payload, savedAt: 99 });
	});

	it('rejects corrupt storage', () => {
		localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, '{not-json');
		expect(loadDisplayMode()).toBeNull();
		localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, JSON.stringify({ mode: 'video' }));
		expect(loadDisplayMode()).toBeNull();
		localStorage.setItem(
			DISPLAY_MODE_STORAGE_KEY,
			JSON.stringify({ mode: 'video', payload: 'javascript:alert(1)', savedAt: 1 }),
		);
		expect(loadDisplayMode()).toBeNull();
	});

	it('legacy entries without savedAt load with savedAt 0', () => {
		localStorage.setItem(
			DISPLAY_MODE_STORAGE_KEY,
			JSON.stringify({ mode: 'video', payload: 'https://cdn.example.com/a.mp4' }),
		);
		expect(loadDisplayMode()).toEqual({
			mode: 'video',
			payload: 'https://cdn.example.com/a.mp4',
			savedAt: 0,
		});
	});
});
