/**
 * Curated landmarks per location — GeoJSON point features.
 *
 * Each landmark is a `Feature<Point>` with properties:
 *   - name: display name
 *   - rank: 1 (hero) .. 3 (secondary)  — drives radius + glow intensity
 *   - category: 'skyscraper' | 'monument' | 'natural' | 'airport' | 'bridge'
 *
 * Featured by Southwest at night: hero landmarks pulse with warm amber
 * glow via feature-state animation. Pure data — designers can ship new
 * .ts or .geojson files without touching the renderer code.
 */

export interface LandmarkFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: {
		id: string;
		name: string;
		rank: 1 | 2 | 3;
		category: 'skyscraper' | 'monument' | 'natural' | 'airport' | 'bridge';
		locationId: string;
	};
}

export type LandmarkCollection = {
	type: 'FeatureCollection';
	features: LandmarkFeature[];
};

const pt = (
	lon: number,
	lat: number,
	id: string,
	name: string,
	rank: 1 | 2 | 3,
	category: LandmarkFeature['properties']['category'],
	locationId: string,
): LandmarkFeature => ({
	type: 'Feature',
	geometry: { type: 'Point', coordinates: [lon, lat] },
	properties: { id, name, rank, category, locationId },
});

/** All landmarks across all locations. Filter client-side by locationId. */
export const LANDMARKS: LandmarkCollection = {
	type: 'FeatureCollection',
	features: [
		// Dubai
		pt(55.2744, 25.1972, 'burj-khalifa', 'Burj Khalifa', 1, 'skyscraper', 'dubai'),
		pt(55.1853, 25.1413, 'burj-al-arab', 'Burj Al Arab', 2, 'monument', 'dubai'),
		pt(55.1391, 25.1124, 'palm-jumeirah', 'Palm Jumeirah', 2, 'monument', 'dubai'),
		pt(55.3657, 25.2531, 'dubai-intl', 'DXB Airport', 3, 'airport', 'dubai'),
		pt(55.2433, 25.0759, 'dubai-marina', 'Dubai Marina', 3, 'skyscraper', 'dubai'),

		// Dallas / Fort Worth
		pt(-96.809, 32.776, 'reunion-tower', 'Reunion Tower', 1, 'skyscraper', 'dallas'),
		pt(-96.794, 32.78, 'dallas-downtown', 'Downtown Dallas', 2, 'skyscraper', 'dallas'),
		pt(-97.038, 32.8969, 'dfw-airport', 'DFW Airport', 3, 'airport', 'dallas'),

		// Phoenix
		pt(-112.074, 33.448, 'phoenix-downtown', 'Downtown Phoenix', 2, 'skyscraper', 'phoenix'),
		pt(-112.012, 33.4352, 'phx-airport', 'PHX Sky Harbor', 3, 'airport', 'phoenix'),

		// Las Vegas
		pt(-115.1739, 36.115, 'vegas-strip', 'Las Vegas Strip', 1, 'monument', 'las-vegas'),
		pt(-115.1523, 36.0840, 'vegas-airport', 'Harry Reid Intl', 3, 'airport', 'las-vegas'),

		// Denver
		pt(-104.9903, 39.7392, 'denver-downtown', 'Downtown Denver', 2, 'skyscraper', 'denver'),
		pt(-104.6737, 39.8561, 'denver-airport', 'DEN Airport', 3, 'airport', 'denver'),

		// Chicago Midway
		pt(-87.7522, 41.7868, 'midway-airport', 'Chicago Midway', 2, 'airport', 'chicago-midway'),
		pt(-87.6278, 41.8825, 'willis-tower', 'Willis Tower', 1, 'skyscraper', 'chicago-midway'),

		// Mumbai
		pt(72.8347, 18.9220, 'gateway-india', 'Gateway of India', 1, 'monument', 'mumbai'),
		pt(72.8692, 19.0896, 'mumbai-airport', 'BOM Airport', 3, 'airport', 'mumbai'),

		// Hyderabad
		pt(78.4747, 17.3616, 'charminar', 'Charminar', 1, 'monument', 'hyderabad'),
		pt(78.4294, 17.2403, 'hyd-airport', 'RGI Airport', 3, 'airport', 'hyderabad'),

		// Himalayas — Everest region
		pt(86.9250, 27.9881, 'everest-summit', 'Mt. Everest Summit', 1, 'natural', 'himalayas'),
		pt(86.8128, 27.9881, 'khumbu-glacier', 'Khumbu Glacier', 2, 'natural', 'himalayas'),
	],
};

/** Get the sub-collection for one location. */
export function landmarksFor(locationId: string): LandmarkCollection {
	return {
		type: 'FeatureCollection',
		features: LANDMARKS.features.filter(f => f.properties.locationId === locationId),
	};
}
