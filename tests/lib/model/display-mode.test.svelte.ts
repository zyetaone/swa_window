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
		expect(loadDisplayMode()?.mode).toBe('flight');
	});

	it('accepts video URL payload and persists it', () => {
		const model = new AeroWindow();
		expect(model.setDisplayMode('video', 'https://cdn.example.com/a.mp4', { decidedAtMs: 5000 })).toBe(true);
		expect(model.displayMode).toBe('video');
		expect(model.videoUrl).toBe('https://cdn.example.com/a.mp4');
		expect(model.slideshow).toBeNull();
		const stored = loadDisplayMode();
		expect(stored?.mode).toBe('video');
		expect(stored?.payload).toBe('https://cdn.example.com/a.mp4');
		expect(stored?.savedAt).toBe(5000);
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
		model.setDisplayMode('screensaver', payload, { decidedAtMs: 10 });
		expect(model.displayMode).toBe('screensaver');
		expect(model.slideshow).toEqual({
			urls: ['/api/assets/deadbeef01234567.png', 'https://x.test/b.jpg'],
			intervalSec: 20,
		});
		expect(model.videoUrl).toBe('');
		const stored = loadDisplayMode();
		expect(stored?.mode).toBe('screensaver');
		expect(stored?.payload).toBe(payload);
		expect(stored?.savedAt).toBe(10);
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
			JSON.stringify({
				mode: 'video',
				payload: 'https://cdn.example.com/restore.mp4',
				savedAt: 9000,
			}),
		);
		const model = new AeroWindow();
		expect(model.displayMode).toBe('video');
		expect(model.videoUrl).toBe('https://cdn.example.com/restore.mp4');
	});

	it('rejects stale fleet decisions older than savedAt (local Escape wins)', () => {
		const model = new AeroWindow();
		expect(model.setDisplayMode('video', 'https://cdn.example.com/a.mp4', { decidedAtMs: 10_000 })).toBe(true);
		// Local Escape at t=20_000
		expect(model.setDisplayMode('flight', undefined, { decidedAtMs: 20_000 })).toBe(true);
		// Stale SSE replay of the old video command
		expect(
			model.setDisplayMode('video', 'https://cdn.example.com/a.mp4', { decidedAtMs: 10_000 }),
		).toBe(false);
		expect(model.displayMode).toBe('flight');
	});

	it('accepts newer fleet decisions after local state', () => {
		const model = new AeroWindow();
		expect(model.setDisplayMode('flight', undefined, { decidedAtMs: 10_000 })).toBe(true);
		expect(
			model.setDisplayMode('video', 'https://cdn.example.com/b.mp4', { decidedAtMs: 11_000 }),
		).toBe(true);
		expect(model.displayMode).toBe('video');
		expect(model.videoUrl).toBe('https://cdn.example.com/b.mp4');
	});
	it('lets force bypass the stale gate, which is what boot restore relies on', () => {
		// The only caller of `force` is the post-boot media restore: it re-applies
		// the STORED mode with the STORED savedAt, which is by definition not
		// newer than what is in storage. Without the bypass a reload would land
		// on flight and the operator's video would silently be gone — on a kiosk
		// that reboots unattended, permanently.
		const model = new AeroWindow();
		expect(model.setDisplayMode('flight', undefined, { decidedAtMs: 20_000 })).toBe(true);
		// Older stamp: rejected normally...
		expect(
			model.setDisplayMode('video', 'https://cdn.example.com/a.mp4', { decidedAtMs: 10_000 }),
		).toBe(false);
		// ...and applied with force.
		expect(
			model.setDisplayMode('video', 'https://cdn.example.com/a.mp4', {
				decidedAtMs: 10_000,
				force: true,
			}),
		).toBe(true);
		expect(model.displayMode).toBe('video');
	});

	it('does not let force smuggle an invalid payload through', () => {
		// force skips the LWW gate ONLY. The payload validators are a trust
		// boundary — a fleet push carrying javascript: must not become
		// applicable just because it also set force.
		const model = new AeroWindow();
		expect(
			model.setDisplayMode('video', 'javascript:alert(1)', { force: true }),
		).toBe(false);
		expect(model.displayMode).toBe('flight');
		expect(model.videoUrl).toBe('');
	});
});
