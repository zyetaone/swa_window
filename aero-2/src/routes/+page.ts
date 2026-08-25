import type { PageLoad } from './$types';

import { readWindowParams } from '#lib/window/params.js';

/**
 * URL knobs are resolved here rather than in the component, so the page
 * receives plain values and never reads `location` itself. `url` is a load
 * dependency, so changing `?place=` re-runs this without a full reload.
 *
 * `ssr = false` lives in `+layout.ts` and cascades to here — page options
 * inherit down the tree, so repeating it would be noise.
 */
export const load: PageLoad = ({ url }) => readWindowParams(url);
