/**
 * setDisplayMode — media payloads + reactive mode state + display-mode persist.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';
import { encodeSlideshowPayload } from '$lib/fleet/display-payload';
import { loadDisplayMode, DISPLAY_MODE_STORAGE_KEY } from '$lib/fleet/display-mode-persist';

describe('AeroWindow.setDisplayMode', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('returns to flight and clears media', () => {
		const model = new AeroWindow();
		expect(model.setDisplayMode('video', 'https://cdn.example.com/a.mp4')).toBe(true);
		expect(model.displayMode).toBe('video');
		expect(model.setDisplayMode('flight')).toBe(true);
		expect(model.displayMode).toBe('flight');
		expect(model.videoUrl).toBe('');
		expect(model.slideshow).toBeNull();
		expect(loadDisplayMode()).toEqual({ mode: 'flight' });
	});

	it('accepts video URL payload and persists it', () => {
		const model = new AeroWindow();
		expect(model.setDisplayMode('video', 'https://cdn.example.com/a.mp4')).toBe(true);
		expect(model.displayMode).toBe('video');
		expect(model.videoUrl).toBe('https://cdn.example.com/a.mp4');
		expect(model.slideshow).toBeNull();
		expect(loadDisplayMode()).toEqual({
			mode: 'video',
			payload: 'https://cdn.example.com/a.mp4',
		});
	});

	it('rejects bad video payload without changing mode and returns false', () => {
		const model = new AeroWindow();
		const ok = model.setDisplayMode('video', 'javascript:alert(1)');
		expect(ok).toBe(false);
		expect(model.displayMode).toBe('flight');
		expect(model.videoUrl).toBe('');
		expect(localStorage.getItem(DISPLAY_MODE_STORAGE_KEY)).toBeNull();
	});

	it('accepts slideshow JSON payload', () => {
		const model = new AeroWindow();
		const payload = encodeSlideshowPayload(
			['/api/assets/deadbeef01234567.png', 'https://x.test/b.jpg'],
			20,
		);
		model.setDisplayMode('screensaver', payload);
		expect(model.displayMode).toBe('screensaver');
		expect(model.slideshow).toEqual({
			urls: ['/api/assets/deadbeef01234567.png', 'https://x.test/b.jpg'],
			intervalSec: 20,
		});
		expect(model.videoUrl).toBe('');
		const stored = loadDisplayMode();
		expect(stored?.mode).toBe('screensaver');
		expect(stored?.payload).toBe(payload);
	});

	it('rejects empty slideshow without changing mode', () => {
		const model = new AeroWindow();
		model.setDisplayMode('screensaver', JSON.stringify({ urls: [] }));
		expect(model.displayMode).toBe('flight');
		expect(model.slideshow).toBeNull();
	});

	it('restores media mode from storage on construct', () => {
		localStorage.setItem(
			DISPLAY_MODE_STORAGE_KEY,
			JSON.stringify({ mode: 'video', payload: 'https://cdn.example.com/restore.mp4' }),
		);
		const model = new AeroWindow();
		expect(model.displayMode).toBe('video');
		expect(model.videoUrl).toBe('https://cdn.example.com/restore.mp4');
	});
});
