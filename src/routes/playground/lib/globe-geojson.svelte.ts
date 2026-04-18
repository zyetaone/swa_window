import type { Feature, FeatureCollection, Point, LineString } from 'geojson';

const pt = (coords: [number, number], props = {}): Feature<Point> => ({
	type: 'Feature',
	geometry: { type: 'Point', coordinates: coords },
	properties: props,
});

const fc = (features: Feature[]): FeatureCollection => ({
	type: 'FeatureCollection',
	features,
});

export function generateFogGeoJSON(lat: number, lon: number, count = 200): FeatureCollection {
	return fc(
		Array.from({ length: count }, () => pt(
			[lon + (Math.random() - 0.5) * 0.8, lat + (Math.random() - 0.5) * 0.8],
			{ weight: Math.random() * 0.5 + 0.5 }
		))
	);
}

export function generateShadowGeoJSON(lat: number, lon: number, shadowTime: number): FeatureCollection {
	return fc(
		Array.from({ length: 25 }, (_, i) => {
			const sx = ((i * 0.741) % 1 + shadowTime * 0.05) % 1;
			return pt([lon + (sx - 0.5) * 2.0, lat + (((i * 0.312) % 1) - 0.5) * 2.0]);
		})
	);
}

const line = (c: [number, number][]): Feature<LineString> => ({
	type: 'Feature',
	geometry: { type: 'LineString', coordinates: c },
	properties: {},
});

export function generateLocalGridGeoJSON(lat: number, lon: number): FeatureCollection {
	const [step, span] = [0.05, 1.0];
	const [cLat, cLon] = [Math.round(lat), Math.round(lon)];
	const features: Feature<LineString>[] = [];
	for (let y = cLat - span; y <= cLat + span; y += step) features.push(line([[cLon - span, y], [cLon + span, y]]));
	for (let x = cLon - span; x <= cLon + span; x += step) features.push(line([[x, cLat - span], [x, cLat + span]]));
	return fc(features);
}
