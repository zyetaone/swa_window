/**
 * Cache revalidation for the per-city GeoJSON routes.
 *
 * These files are packager OUTPUT and they DO change — a road re-extract
 * rewrote all eight cities at once. `git pull` is the deploy mechanism, so the
 * new bytes reach the Pi; the question is whether the BROWSER ever asks for
 * them.
 *
 * It did not. The route sent `max-age=86400` and the loader asked with
 * `cache: 'force-cache'`, which returns a stale entry regardless of age. Caught
 * live: the dev server was serving 21,781 features while the page had 3,447
 * loaded and no error anywhere. On a kiosk that never navigates away that is
 * effectively permanent — the wall shows last week's city.
 */
import { describe, it, expect } from 'vitest';
import { serveCityGeojson } from '$lib/server/bundle/geojson';

describe('a changed extract can actually reach the client', () => {
	it('offers a validator so the browser has something to revalidate against', () => {
		// Without an ETag the only options are "re-download 5 MB every frame of
		// paranoia" or "trust max-age and go stale". The validator is what makes
		// must-revalidate affordable.
		return serveCityGeojson('hyderabad', 'roads').then((res) => {
			expect(res.status).toBe(200);
			expect(res.headers.get('etag')).toBeTruthy();
		});
	});

	it('never lets the browser skip revalidation', async () => {
		// `must-revalidate` was tried first and is NOT sufficient: it only applies
		// once an entry is stale, so with max-age=86400 the browser still serves
		// day-old geometry without asking. That is exactly what happened — the
		// server returned 3,447 features while the page rendered 21,781, through
		// a hard reload. Assert the property (must ask every time), so a future
		// "optimisation" back to max-age fails here.
		const res = await serveCityGeojson('hyderabad', 'roads');
		const cc = res.headers.get('cache-control') ?? '';
		expect(cc).toContain('no-cache');
		expect(cc).not.toMatch(/max-age=(?!0\b)\d+/);
	});

	it('answers 304 with no body when the client already has these bytes', async () => {
		// The whole point of the validator: revalidation must be cheap, because
		// these payloads are ~5 MB and eight cities load over one flight.
		const first = await serveCityGeojson('hyderabad', 'roads');
		const etag = first.headers.get('etag');
		const second = await serveCityGeojson('hyderabad', 'roads', etag);
		expect(second.status).toBe(304);
		expect(await second.text()).toBe('');
	});

	it('sends the body when the client holds a DIFFERENT version', async () => {
		// The regression case, stated directly: a Pi holding last week's extract
		// must be given the new one.
		const res = await serveCityGeojson('hyderabad', 'roads', 'W/"stale-etag"');
		expect(res.status).toBe(200);
		expect((await res.text()).length).toBeGreaterThan(0);
	});

	it('changes the validator when the file changes', async () => {
		// Size+mtime, so a re-extract always produces a new tag. Two different
		// cities stand in for two different versions of one file — if the tag
		// were constant this would fail.
		const a = await serveCityGeojson('hyderabad', 'roads');
		const b = await serveCityGeojson('dallas', 'roads');
		expect(a.headers.get('etag')).not.toBe(b.headers.get('etag'));
	});

	it('applies the same contract to buildings', async () => {
		// Buildings had the identical force-cache/max-age pairing.
		const res = await serveCityGeojson('hyderabad', 'buildings');
		expect(res.headers.get('etag')).toBeTruthy();
		expect(res.headers.get('cache-control')).toContain('no-cache');
	});

	it('still rejects an unknown city rather than leaking a path probe', async () => {
		const res = await serveCityGeojson('../../etc/passwd', 'roads');
		expect(res.status).toBe(404);
	});
});
