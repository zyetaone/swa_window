/**
 * Texture selection — which imagery source, and at what detail.
 *
 * Deliberately ONE function for both. In the shipping app "which texture" and
 * "how much detail" are separate concerns keyed off altitude independently
 * (altitudeDetailMix, the imagery layer, night-light scaling), which is how
 * they drifted. Here detail is not re-derived from altitude at all: it is read
 * from the band model's groundDetail, so altitude has exactly one place where
 * it turns into look.
 *
 * Both swaps are hysteretic. A base-layer change is a full retile — visible
 * and expensive — and on three panes an un-damped threshold would not flip on
 * the same frame, which is a torn wall rather than a slow one.
 *
 * Pure: same inputs give the same selection, no clock, no randomness.
 */
import { IMAGERY_SOURCES, type ImagerySource } from '#content/imagery/sources.js';
import { exceedsDeadband } from '#lib/utils.js';

/**
 * Margin the incumbent source keeps at the day/night crossover.
 *
 * Not a deadband: this is a two-candidate contest, so the challenger must be
 * clearly nearer, not merely nearer. A base-layer swap is a full retile.
 */
const NIGHT_SWAP_HYSTERESIS = 0.08;

/**
 * Extra drift required before the zoom cap steps.
 *
 * Caps are integers, so a full level of change is inherent; this is the slack
 * on top of it that stops a slow climb retiling the globe repeatedly.
 */
const DETAIL_STEP_HYSTERESIS = 0.35;

export interface ImagerySelection {
	readonly sourceId: string;
	readonly urlTemplate: string;
	/** Deepest zoom to request. Never exceeds what the packs actually hold. */
	readonly maximumLevel: number;
}

export interface ImageryInput {
	/** From resolveAtmosphere(). 1 = ground legible, 0 = nothing to see. */
	readonly groundDetail: number;
	/** 0 day .. 1 night. */
	readonly nightFactor: number;
	/** Previous selection, so swaps can be damped. Null on first call. */
	readonly current: ImagerySelection | null;
}

function clamp01(n: number): number {
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function sourceById(id: string): ImagerySource | undefined {
	return IMAGERY_SOURCES.find((s) => s.id === id);
}

/** Source whose nightAnchor sits nearest the current nightFactor. */
function nearestSource(nightFactor: number): ImagerySource {
	return IMAGERY_SOURCES.reduce((best, s) =>
		Math.abs(s.nightAnchor - nightFactor) < Math.abs(best.nightAnchor - nightFactor) ? s : best,
	);
}

/**
 * Pick the base source, holding the incumbent until the challenger is clearly
 * better. The margin is what stops a flip-flop at the crossover.
 */
function selectSource(nightFactor: number, current: ImagerySelection | null): ImagerySource {
	const target = nearestSource(nightFactor);
	if (!current) return target;

	const incumbent = sourceById(current.sourceId);
	if (!incumbent || incumbent.id === target.id) return target;

	const incumbentDistance = Math.abs(incumbent.nightAnchor - nightFactor);
	const targetDistance = Math.abs(target.nightAnchor - nightFactor);
	return incumbentDistance - targetDistance > NIGHT_SWAP_HYSTERESIS ? target : incumbent;
}

/**
 * Map ground legibility onto a zoom cap within the source's real range.
 *
 * At cruise the ground is a smear, so requesting the deepest tiles buys
 * nothing but fill rate and decode time — the cap comes down with
 * groundDetail. The step is damped because zoom caps are integers and each
 * change retiles the globe.
 */
export function selectDetailLevel(
	source: ImagerySource,
	groundDetail: number,
	currentLevel: number | null,
): number {
	const [min, max] = source.zoomRange;
	const target = min + (max - min) * clamp01(groundDetail);

	if (currentLevel === null) return Math.round(target);

	const held = Math.min(max, Math.max(min, currentLevel));
	return exceedsDeadband(held, target, 1 + DETAIL_STEP_HYSTERESIS) ? Math.round(target) : held;
}

/** The single entry point: atmosphere state and time of day in, texture out. */
export function selectImagery(input: ImageryInput): ImagerySelection {
	const source = selectSource(clamp01(input.nightFactor), input.current);

	// A level held across a source swap is only meaningful if the source is
	// the same one it was measured against.
	const heldLevel =
		input.current && input.current.sourceId === source.id ? input.current.maximumLevel : null;

	return {
		sourceId: source.id,
		urlTemplate: source.urlTemplate,
		maximumLevel: selectDetailLevel(source, input.groundDetail, heldLevel),
	};
}

/** Hold day imagery when a night pack is absent from the local cache. */
export function gateImagerySelection(
	selection: ImagerySelection,
	layerAvailable: (id: string) => boolean,
): ImagerySelection {
	if (layerAvailable(selection.sourceId)) return selection;
	const day = IMAGERY_SOURCES.find((s) => s.nightAnchor === 0);
	if (!day || selection.sourceId === day.id) return selection;
	return {
		sourceId: day.id,
		urlTemplate: day.urlTemplate,
		maximumLevel: selection.maximumLevel,
	};
}
