/**
 * Content bundle — a pushable unit of scene content.
 *
 * Bundles carry their own metadata, data URLs, and activation rules.
 * The shape is intentionally JSON-friendly: no functions, no closures —
 * so it can travel over HTTP, be stored on disk, or come from an admin UI.
 *
 * Runtime translation:
 *   ContentBundle → loader.ts → Effect → registry merge → compositor mount
 */

import type { LocationId, SkyState, WeatherType } from '$lib/types';
import type { LayerKind } from '../types';

/**
 * Bundle type — selects which factory in loader.ts processes the bundle.
 * Add a new type when adding a new parameterizable effect (see video-bg).
 */
export type BundleType = 'video-bg' | 'sprite';

/**
 * Declarative when-predicate. Evaluated against AeroWindow at render time.
 * All fields are AND-ed; within a field, values are OR-ed (e.g. any of these locations).
 * Omitted fields impose no constraint.
 */
export interface WhenPredicate {
	/** Active only when current location matches one of these. */
	location?: LocationId[];
	/** Active only when nightFactor is within [min, max]. */
	nightFactor?: { min?: number; max?: number };
	/** Active only when skyState matches one of these. */
	skyState?: SkyState[];
	/** Active only when weather matches one of these. */
	weather?: WeatherType[];
}

/** Shared fields across all bundle types. */
export interface BundleBase {
	id: string;
	type: BundleType;
	kind: LayerKind;
	/** CSS z-index within scene-content. */
	z: number;
	/** Activation predicate. Omit for always-on. */
	when?: WhenPredicate;
}

/** video-bg bundle — full-scene HTML5 <video> loop. */
export interface VideoBgBundle extends BundleBase {
	type: 'video-bg';
	/** URL of the video asset (relative or absolute). */
	asset: string;
	/** CSS object-fit value — default 'cover'. */
	fit?: 'cover' | 'contain' | 'fill';
	/** Opacity 0..1, default 1. */
	opacity?: number;
	/** CSS mix-blend-mode, default 'normal'. */
	blend?: 'normal' | 'screen' | 'multiply' | 'overlay';
}

/**
 * sprite bundle — single Cesium Billboard at a geo-position.
 * Use cases: Santa sleigh in December, passing-plane silhouette,
 * landmark markers, brand overlays.
 */
export interface SpriteBundle extends BundleBase {
	type: 'sprite';
	/** URL of the image asset (PNG/JPG/WebP). */
	image: string;
	/** Geo-position. */
	lat: number;
	lon: number;
	/** Meters above ellipsoid. Omit for clamp-to-ground. */
	altitude?: number;
	/** Pixel size — default 48×48. */
	width?: number;
	height?: number;
}

/** Union of all bundle shapes — extend when adding new BundleType. */
export type ContentBundle = VideoBgBundle | SpriteBundle;
