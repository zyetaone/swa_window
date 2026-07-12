/**
 * GET /api/roads/:city → slim GeoJSON of OSM road LineStrings for that
 * city's default radius. Shared handler: $lib/http/geojson.server.
 *
 * Each feature: LineString geometry + `properties.class` (highway tag).
 * Classes restricted to motorway / trunk / primary / secondary /
 * tertiary / residential — enough to build a city skeleton without
 * clutter from service / track / footway.
 */
import { serveCityGeojson } from '$lib/http/geojson.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => serveCityGeojson(params.city, 'roads');
