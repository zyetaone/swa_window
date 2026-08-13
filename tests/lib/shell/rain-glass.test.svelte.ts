/**
 * RainGlass determinism — the 3-Pi seam invariant.
 *
 * The bead layout used to come from Math.random(), so the left/center/right
 * panes of a corridor wall each rolled their own raindrop pattern and the
 * seam was visible. The pool must draw from createSeededRng(daySeed()) so
 * every Pi lays out identical beads on the same day. Two mounts in one
 * session is the strongest pin available to a unit test: Math.random()
 * would reshuffle between them, the seeded rng must not.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import RainGlassMount from '../../fixtures/RainGlassMount.svelte';

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

function mountBeadHtml(): string {
	app = mount(RainGlassMount, { target: document.body });
	const html = document.body.querySelector('.rain-glass')?.innerHTML ?? '';
	unmount(app);
	app = null;
	document.body.innerHTML = '';
	return html;
}

describe('RainGlass bead layout', () => {
	it('renders beads while raining', () => {
		app = mount(RainGlassMount, { target: document.body });
		expect(document.querySelectorAll('.rain-glass .bead').length).toBeGreaterThan(0);
	});

	it('is identical across mounts — seeded, not Math.random()', () => {
		const first = mountBeadHtml();
		const second = mountBeadHtml();
		expect(first).not.toBe('');
		expect(first).toBe(second);
	});
});
