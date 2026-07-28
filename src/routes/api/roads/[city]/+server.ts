/**
 * GET /api/roads/:city → slim GeoJSON of OSM road LineStrings for that
 * city's default radius. Shared handler: $lib/http/geojson.server.
 *
 * Each feature: LineString geometry + `properties.class` (highway tag).
 * Classes restricted to motorway / trunk / primary / secondary /
 * tertiary / residential — enough to build a city skeleton without
 * clutter from service / track / footway.
 *
 * Same-origin only — no CORS headers. Only this Pi's kiosk browser fetches
 * GeoJSON; peer Pis ship pre-baked vector tiles via /api/tiles/.
 */
import { serveCityGeojson } from '$lib/server/scene/bundle/geojson';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => serveCityGeojson(params.city, 'roads');
