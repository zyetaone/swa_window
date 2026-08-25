/**
 * Which base texture, and how deep to zoom it. Hysteresis lives here so the
 * pick does not flicker at a boundary.
 */
import {
	DAY_IMAGERY_IDS,
	IMAGERY_SOURCES,
	type ImagerySource,
} from '#lib/world/imagery/model.js';

const NIGHT_SWAP_HYSTERESIS = 0.08;
const DETAIL_STEP_HYSTERESIS = 0.35;

export interface ImagerySelection {
	readonly sourceId: string;
	readonly urlTemplate: string;
	readonly maximumLevel: number;
}

export interface ImageryInput {
	readonly groundDetail: number;
	readonly nightFactor: number;
	readonly current: ImagerySelection | null;
}

/** True when `target` has drifted far enough from `held` to swap. */
function exceedsDeadband(held: number | null, target: number, threshold: number): boolean {
	return held === null || Math.abs(target - held) >= threshold;
}

function clamp01(n: number): number {
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function sourceById(id: string): ImagerySource | undefined {
	return IMAGERY_SOURCES.find((s) => s.id === id);
}

function nearestSource(nightFactor: number): ImagerySource {
	return IMAGERY_SOURCES.reduce((best, s) =>
		Math.abs(s.nightAnchor - nightFactor) < Math.abs(best.nightAnchor - nightFactor) ? s : best,
	);
}

function selectSource(nightFactor: number, current: ImagerySelection | null): ImagerySource {
	const target = nearestSource(nightFactor);
	if (!current) return target;

	const incumbent = sourceById(current.sourceId);
	if (!incumbent || incumbent.id === target.id) return target;

	const incumbentDistance = Math.abs(incumbent.nightAnchor - nightFactor);
	const targetDistance = Math.abs(target.nightAnchor - nightFactor);
	return incumbentDistance - targetDistance > NIGHT_SWAP_HYSTERESIS ? target : incumbent;
}

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

export function selectImagery(input: ImageryInput): ImagerySelection {
	const source = selectSource(clamp01(input.nightFactor), input.current);

	const heldLevel =
		input.current && input.current.sourceId === source.id ? input.current.maximumLevel : null;

	return {
		sourceId: source.id,
		urlTemplate: source.urlTemplate,
		maximumLevel: selectDetailLevel(source, input.groundDetail, heldLevel),
	};
}

export function gateImagerySelection(
	selection: ImagerySelection,
	layerAvailable: (id: string) => boolean,
): ImagerySelection {
	if (layerAvailable(selection.sourceId)) return selection;

	for (const id of DAY_IMAGERY_IDS) {
		if (!layerAvailable(id)) continue;
		const src = IMAGERY_SOURCES.find((s) => s.id === id);
		if (!src) continue;
		return {
			sourceId: src.id,
			urlTemplate: src.urlTemplate,
			maximumLevel: selection.maximumLevel,
		};
	}

	return selection;
}
