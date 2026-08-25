import type { PageLoad } from './$types';
import { readPaneParams } from '#lib/flight/url-params.js';

export const load: PageLoad = ({ url }) => readPaneParams(url);
