/**
 * Scene composition — contract shared by all effects.
 *
 * An Effect is a self-contained piece of the visual scene: it owns its own
 * internal state (via $state in its component) and renders a Svelte component
 * that receives the AeroWindow (and optional params) as props.
 *
 * Effects are registered in registry.ts (static stock effects) OR produced at
 * runtime by the bundle loader (dynamic, pushed content). Both paths converge
 * at compositor.svelte which iterates the merged list in z-order.
 *
 * Adding a new stock effect: one folder under scene/effects/<name>/ exporting
 * a default Effect from index.ts, plus a line in registry.ts.
 *
 * Adding a new parameterized effect *type*: one folder + a factory function
 * that takes params and returns an Effect.
 */

import type { Component } from 'svelte';
import type { AeroWindow } from '$lib/model/aero-window.svelte';

/**
 * Conceptual layer the effect belongs to.
 * Used for reasoning and future ordering; not enforced at runtime.
 *
 * - geo    : positioned in world coordinates (e.g. car lights, passing plane)
 * - atmo   : between camera and world (clouds, lightning, contrails, aurora)
 * - window : on the glass (frost, raindrops, bug splats)
 * - frame  : cockpit/window structure (wing, vignette — usually static)
 */
export type LayerKind = 'geo' | 'atmo' | 'window' | 'frame';

/**
 * Effect props — every effect component receives exactly this.
 * `params` is present for parameterized effects (video-bg with a URL,
 * sprite with a sprite-sheet, etc.). Stock hand-coded effects omit it.
 */
export interface EffectProps<TParams = undefined> {
	model: AeroWindow;
	params?: TParams;
}

/** A registered scene effect. */
export interface Effect<TParams = undefined> {
	/** Stable identifier — used for keyed iteration, debug overlays, future admin toggles. */
	id: string;
	/** Conceptual layer — where this sits in the stack. */
	kind: LayerKind;
	/** CSS z-index within scene-content. Lower = further from camera. */
	z: number;
	/**
	 * Reactive predicate: return true when the effect should be mounted.
	 * Omit for always-on effects. Evaluated inside a compositor {#if}, so any
	 * model.* access is tracked and the effect mounts/unmounts automatically.
	 */
	when?: (model: AeroWindow) => boolean;
	/** The component to render. Receives EffectProps<TParams>. */
	component: Component<EffectProps<TParams>>;
	/**
	 * Static data passed to the component on every render. Used by parameterized
	 * effect types (video-bg, sprite). Stock effects leave this undefined.
	 */
	params?: TParams;
}
