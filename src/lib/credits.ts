/**
 * Product attribution — SSOT for on-screen + docs copy.
 *
 * Aero Dynamic Window is a Zyeta product. Engine and architecture by
 * rdtect (Rick / rdtect systems). Keep this module free of runes and
 * DOM so server routes, wiki, and kiosk can all import it.
 *
 * When restyling BootLockup or the Plymouth splash, keep the partner
 * line in sync with PRODUCT_PARTNERS / ENGINEERED_BY below — or the
 * cold-boot handoff will read as three different brands.
 */

export const PRODUCT_NAME = 'Aero Dynamic Window';
export const PRODUCT_SHORT = 'Aero Window';

/** Commercial product owner / fleet operator brand. */
export const PRODUCT_OWNER = 'Zyeta';

/** Engine, architecture, and systems engineering. */
export const ENGINEERED_BY = 'rdtect';

/** Install partners shown on the boot lockup (order is load-bearing for SWA). */
export const PRODUCT_PARTNERS = ['Zyeta', 'SWA'] as const;

export const PRODUCT_YEAR = 2026;

/** One-line credit for footers and meta. */
export const PRODUCT_CREDIT_LINE =
	`${PRODUCT_NAME} · ${PRODUCT_OWNER} · engineered by ${ENGINEERED_BY} · ${PRODUCT_YEAR}`;

/** Slightly longer credit for wiki / architecture surfaces. */
export const PRODUCT_CREDIT_BLURB =
	`${PRODUCT_SHORT} is a ${PRODUCT_OWNER} product. Engine, architecture, and fleet systems by ${ENGINEERED_BY}.`;
