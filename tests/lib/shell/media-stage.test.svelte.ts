/**
 * MediaStage — mount contract: error empty state, slideshow dots, no crash.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { AeroWindow } from '$lib/model/aero-window.svelte';
import MediaStageMount from '../../fixtures/MediaStageMount.svelte';

let app: Record<string, unknown> | null = null;
let model: AeroWindow;

beforeEach(() => {
	localStorage.clear();
	vi.useFakeTimers();
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.clearAllTimers();
	vi.useRealTimers();
});

function mountStage(props: {
	mode?: 'video' | 'screensaver';
	videoUrl?: string;
	slideshow?: { urls: string[]; intervalSec: number } | null;
}) {
	app = mount(MediaStageMount, {
		target: document.body,
		props: {
			onprovide: (m: AeroWindow) => {
				model = m;
			},
			mode: props.mode ?? 'video',
			videoUrl: props.videoUrl ?? '',
			slideshow: props.slideshow ?? null,
		},
	});
	flushSync();
}

describe('MediaStage', () => {
	it('mounts video mode with a video element', () => {
		mountStage({ mode: 'video', videoUrl: 'https://cdn.example.com/a.mp4' });
		const video = document.querySelector('video.media');
		expect(video).not.toBeNull();
		expect(video?.getAttribute('src')).toBe('https://cdn.example.com/a.mp4');
		expect(model).toBeDefined();
	});

	it('mounts slideshow with image + dots for multi-url playlists', () => {
		mountStage({
			mode: 'screensaver',
			slideshow: {
				urls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
				intervalSec: 5,
			},
		});
		expect(document.querySelector('img.media')).not.toBeNull();
		expect(document.querySelectorAll('.dot').length).toBe(2);
	});

	it('shows empty state when video mode has no url', () => {
		mountStage({ mode: 'video', videoUrl: '' });
		expect(document.querySelector('.empty')?.textContent).toMatch(/No media/i);
	});

	it('advances slideshow on interval', () => {
		mountStage({
			mode: 'screensaver',
			slideshow: {
				urls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
				intervalSec: 3,
			},
		});
		const first = document.querySelector('img.media')?.getAttribute('src');
		expect(first).toBe('https://cdn.example.com/a.png');
		vi.advanceTimersByTime(3000);
		flushSync();
		const second = document.querySelector('img.media')?.getAttribute('src');
		expect(second).toBe('https://cdn.example.com/b.png');
	});
});
