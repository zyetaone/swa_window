import { describe, it, expect, beforeEach } from 'vitest';
import {
	saveDisplayMode,
	loadDisplayMode,
	DISPLAY_MODE_STORAGE_KEY,
} from '$lib/fleet/display-mode-persist';
import { encodeSlideshowPayload } from '$lib/fleet/display-payload';

describe('display-mode-persist', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('round-trips flight (clears media)', () => {
		saveDisplayMode('video', 'https://cdn.example.com/a.mp4');
		saveDisplayMode('flight');
		expect(loadDisplayMode()).toEqual({ mode: 'flight' });
	});

	it('round-trips video URL', () => {
		saveDisplayMode('video', 'https://cdn.example.com/a.mp4');
		expect(loadDisplayMode()).toEqual({
			mode: 'video',
			payload: 'https://cdn.example.com/a.mp4',
		});
	});

	it('round-trips slideshow payload', () => {
		const payload = encodeSlideshowPayload(['https://x.test/a.png', 'https://x.test/b.jpg'], 20);
		saveDisplayMode('screensaver', payload);
		expect(loadDisplayMode()).toEqual({ mode: 'screensaver', payload });
	});

	it('rejects corrupt storage', () => {
		localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, '{not-json');
		expect(loadDisplayMode()).toBeNull();
		localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, JSON.stringify({ mode: 'video' }));
		expect(loadDisplayMode()).toBeNull();
		localStorage.setItem(
			DISPLAY_MODE_STORAGE_KEY,
			JSON.stringify({ mode: 'video', payload: 'javascript:alert(1)' }),
		);
		expect(loadDisplayMode()).toBeNull();
	});
});
