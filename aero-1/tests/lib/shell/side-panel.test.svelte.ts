/**
 * SidePanel auto-close — keyboard activity must reset the dismiss timer.
 *
 * The idle auto-close only re-armed on pointermove, so a keyboard user
 * tabbing through the focus trap could have the panel close mid-Tab. Any
 * keydown inside the panel is activity and must reset the timer, exactly
 * like pointer movement does.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SidePanelMount from '../../fixtures/SidePanelMount.svelte';

const AUTO_CLOSE_MS = 15_000; // config.shell.sidePanelAutoCloseMs default
const CLOSE_ANIM_MS = 200;

let app: Record<string, unknown> | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.clearAllTimers();
	vi.useRealTimers();
});

const panel = () => document.querySelector('.panel');

function openPanel() {
	app = mount(SidePanelMount, { target: document.body });
	flushSync();
	document.querySelector<HTMLButtonElement>('.panel-tab')!.click();
	flushSync();
	expect(panel()).not.toBeNull();
}

function keydown(el: Element, key: string) {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	flushSync();
}

describe('SidePanel auto-close', () => {
	it('closes after the idle timeout with no activity', () => {
		openPanel();
		vi.advanceTimersByTime(AUTO_CLOSE_MS + CLOSE_ANIM_MS);
		flushSync();
		expect(panel()).toBeNull();
	});

	it('pointer movement resets the dismiss timer', () => {
		openPanel();
		vi.advanceTimersByTime(AUTO_CLOSE_MS - 1);
		panel()!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
		flushSync();
		vi.advanceTimersByTime(AUTO_CLOSE_MS - 1);
		flushSync();
		expect(panel()).not.toBeNull(); // would be closed without the reset
	});

	it('keyboard interaction resets the dismiss timer (mid-Tab must not close)', () => {
		openPanel();
		// Tab through the trap just before the deadline, twice.
		vi.advanceTimersByTime(AUTO_CLOSE_MS - 1);
		keydown(panel()!, 'Tab');
		vi.advanceTimersByTime(AUTO_CLOSE_MS - 1);
		keydown(panel()!, 'Tab');
		vi.advanceTimersByTime(AUTO_CLOSE_MS - 1);
		flushSync();
		expect(panel()).not.toBeNull(); // 3× idle window elapsed since open

		// Idle again — now it closes on schedule.
		vi.advanceTimersByTime(1 + CLOSE_ANIM_MS);
		flushSync();
		expect(panel()).toBeNull();
	});
});
