import type { PageLoad } from './$types';

import { readWindowParams } from '#lib/window/params.js';

/** WebGL must not SSR, and maplibre-gl touches browser globals at import. */
export const ssr = false;
export const prerender = false;

/**
 * URL knobs are resolved here rather than in the component, so the page
 * receives plain values and never reads `location` itself. `url` is a load
 * dependency, so changing `?place=` re-runs this without a reload.
 */
export const load: PageLoad = ({ url }) => readWindowParams(url);
