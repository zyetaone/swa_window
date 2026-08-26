import { describe, it, expect } from 'vitest';
import { GET as getBuildings } from '../src/routes/api/buildings/[city]/+server.js';
import { GET as getRoads } from '../src/routes/api/roads/[city]/+server.js';

describe('GeoJSON server endpoints', () => {
	it('returns 404 for unknown city', async () => {
		const req = new Request('http://localhost:5173/api/buildings/atlantis');
		const res = await getBuildings({ params: { city: 'atlantis' }, request: req } as any);
		expect(res.status).toBe(404);
	});

	it('serves valid city GeoJSON response for known location', async () => {
		const req = new Request('http://localhost:5173/api/buildings/denver');
		const res = await getBuildings({ params: { city: 'denver' }, request: req } as any);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('geo+json');
		const data = await res.json();
		expect(data.type).toBe('FeatureCollection');
	});

	it('serves valid road network GeoJSON for known location', async () => {
		const req = new Request('http://localhost:5173/api/roads/denver');
		const res = await getRoads({ params: { city: 'denver' }, request: req } as any);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.type).toBe('FeatureCollection');
	});
});
