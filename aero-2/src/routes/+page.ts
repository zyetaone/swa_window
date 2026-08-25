import type { PageLoad } from './$types';
import { readPaneParams } from '#lib/sim/url-params.js';

export const load: PageLoad = ({ url }) => readPaneParams(url);
