/**
 * Product attribution — SSOT for on-screen + docs copy.
 *
 * Aero Dynamic Window is a Zyeta product. Engine and architecture by
 * rdtect (Rick / rdtect systems). Keep this module free of runes and
 * DOM so server routes, wiki, and kiosk can all import it.
 */

export const PRODUCT_NAME = 'Aero Dynamic Window';
export const PRODUCT_SHORT = 'Aero Window';

/** Commercial product owner / fleet operator brand. */
export const PRODUCT_OWNER = 'Zyeta';

/** Engine, architecture, and systems engineering. */
export const ENGINEERED_BY = 'rdtect';

/** Install partners shown on the boot lockup. */
export const PRODUCT_PARTNERS = ['Zyeta', 'SWA'] as const;

export const PRODUCT_YEAR = 2026;

/**
 * Release stage, shown on OPERATOR surfaces only (admin, wiki) — never on the
 * window itself.
 */
export const PRODUCT_STAGE: string | null = 'Beta';

/** One-line credit for footers and meta. */
export const PRODUCT_CREDIT_LINE = `${PRODUCT_NAME} · ${PRODUCT_OWNER} · engineered by ${ENGINEERED_BY} · ${PRODUCT_YEAR}`;

/** Slightly longer credit for wiki / architecture surfaces. */
export const PRODUCT_CREDIT_BLURB = `${PRODUCT_SHORT} is a ${PRODUCT_OWNER} product. Engine, architecture, and fleet systems by ${ENGINEERED_BY}.`;
