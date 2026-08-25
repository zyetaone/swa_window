import type { PageLoad } from './$types';
import { readWindowParams } from '#lib/sim/params.js';

export const load: PageLoad = ({ url }) => readWindowParams(url);
