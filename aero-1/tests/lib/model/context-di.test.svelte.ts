/**
 * AeroWindow context DI — mounted for real.
 *
 * `tryUseAeroWindow()` is the "mountable in both trees" escape hatch: the kiosk
 * provides a model, /admin does not. It returned `getAeroWindowContext() ?? null`
 * — but `createContext()`'s getter THROWS `missing_context` when unset rather
 * than returning undefined, so the `?? null` was unreachable. Every
 * context-optional component then threw during init and /admin rendered a BLANK
 * PAGE, while `bun run check` and all 489 tests stayed green.
 *
 * These mount actual components, because that is the only faithful reproduction:
 * `$effect.root` is not a component scope (`hasContext` refuses there), so a
 * rune-only test would have proved nothing about the real failure.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import ContextOptional from '../../fixtures/ContextOptional.svelte';
import ContextProvider from '../../fixtures/ContextProvider.svelte';

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('context-optional component with NO provider (the /admin case)', () => {
	it('mounts instead of throwing missing_context', () => {
		let resolved: unknown = 'never called';
		expect(() => {
			app = mount(ContextOptional, {
				target: document.body,
				props: { onresolve: (m: unknown) => (resolved = m) },
			});
		}).not.toThrow();
		expect(resolved).toBeNull();
	});

	it('actually renders its markup', () => {
		app = mount(ContextOptional, {
			target: document.body,
			props: { onresolve: () => {} },
		});
		// The blank-page symptom: before the fix, nothing reached the DOM.
		expect(document.body.textContent).toContain('mounted');
	});
});

describe('context-optional component WITH a provider (the kiosk case)', () => {
	it('receives the provided model', () => {
		let resolved: unknown = null;
		let provided: unknown = null;
		app = mount(ContextProvider, {
			target: document.body,
			props: {
				onresolve: (m: unknown) => (resolved = m),
				onprovide: (m: unknown) => (provided = m),
			},
		});
		expect(provided).not.toBeNull();
		expect(resolved).toBe(provided);
		expect(document.body.textContent).toContain('mounted');
	});
});
