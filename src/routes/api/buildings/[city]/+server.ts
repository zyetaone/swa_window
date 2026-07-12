/**
 * GET /api/buildings/:city → slim extrusion-ready GeoJSON for OSM buildings
 * within that city's default radius. Shared handler: $lib/http/geojson.server.
 */
import { serveCityGeojson } from '$lib/http/geojson.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => serveCityGeojson(params.city, 'buildings');
