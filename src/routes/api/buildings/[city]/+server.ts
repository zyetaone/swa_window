/**
 * GET /api/buildings/:city → slim extrusion-ready GeoJSON for OSM buildings
 * within that city's default radius. Shared handler: $lib/http/geojson.server.
 *
 * Same-origin only — no CORS headers. Only this Pi's kiosk browser fetches
 * GeoJSON; peer Pis ship pre-baked vector tiles via /api/tiles/. The
 * unexported GeoJSON endpoints stay unexposed to keep the LAN surface small.
 */
import { serveCityGeojson } from '$lib/server/bundle/geojson';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => serveCityGeojson(params.city, 'buildings');
