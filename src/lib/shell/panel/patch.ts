import { tryUseAeroWindow } from '$lib/model/aero-window.svelte';
import { config, applyConfigPatch } from '$lib/model/config-tree.svelte';

type ConfigTree = typeof config;
type ConfigPatchFn = typeof applyConfigPatch;

/**
 * patchNum — oninput factory for numeric RangeSliders that write through the
 * config-patch gate. Collapses the repeated
 * `oninput={(e) => patch('path', parseFloat(e.currentTarget.value))}` lambda
 * into `oninput={patchNum(patch, 'path')}`.
 */
export function patchNum(patch: (path: string, value: unknown) => void, path: string) {
	return (e: Event) => patch(path, parseFloat((e.currentTarget as HTMLInputElement).value));
}

/**
 * Resolve the config source + write gate for a panel control.
 *
 * Panel controls mount in TWO trees: the kiosk SidePanel, which has an
 * AeroWindow context (so writes should go through `model.applyConfigPatch` and
 * pick up telemetry + fleet broadcast), and /admin, which has no context (so
 * writes go through the module-level gate and reach peers via startPeerSync).
 *
 * Getting this wrong is silent. Reading `config` directly in the kiosk shows
 * the wrong tree; writing `config.X = v` instead of patching skips the CRDT
 * stamp and the prototype-pollution guard, and fleet sync just stops working
 * with no error. Both panels spelled the same three lines out by hand —
 * including the easy-to-miss `.bind(model)`, without which `applyConfigPatch`
 * loses its `this`.
 */
export function usePanelConfig(): { cfg: ConfigTree; patch: ConfigPatchFn } {
	const model = tryUseAeroWindow();
	return {
		cfg: model?.config ?? config,
		patch: model ? model.applyConfigPatch.bind(model) : applyConfigPatch,
	};
}
