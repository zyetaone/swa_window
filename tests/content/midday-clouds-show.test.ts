/**
 * "Over the Deck" — the conditions that make this show work.
 *
 * Every ingredient here already existed; the show is just the combination.
 * That is exactly why it needs pinning: nothing in the renderer knows this
 * show has a premise, so a plausible tuning edit elsewhere (swap the weather
 * to overcast, move the hour, lower the location's cruise) silently turns
 * "blue sky over a cloud floor" back into the muddy in-weather view it was
 * chosen to avoid, and no other test would notice.
 *
 * These are the four things that must all hold at once, stated as the
 * premise rather than as the values.
 */
import { describe, it, expect } from 'vitest';
import { middayCloudsShow } from '$content/shows/midday-clouds.show';
import { DAILY_ROTATION } from '$content/shows';
import { WEATHER_EFFECTS } from '$content/weather';
import { LOCATION_MAP } from '$content/locations';
import { getSkyState } from '$lib/utils';
import { CLOUD_ALT_M } from '$lib/world/clouds/billboard-layer';

const FT_PER_M = 3.28084;

describe('Over the Deck plays the premise it was authored for', () => {
	it('opens in full daylight, not dawn or dusk', () => {
		// "Blue sky above" is only true in the day band. An hour that drifted
		// into dusk would still render a sky — just not this show's sky.
		expect(getSkyState(middayCloudsShow.opening.timeOfDay)).toBe('day');
	});

	it('cruises above the cloud deck rather than inside it', () => {
		// The whole premise is a floor of cloud BELOW the window. If the
		// location's cruise ever drops near the deck the show becomes the
		// inside-the-weather view, which monsoon-mumbai already covers.
		const loc = LOCATION_MAP.get(middayCloudsShow.opening.location);
		expect(loc).toBeDefined();
		expect(loc!.defaultAltitude / FT_PER_M).toBeGreaterThan(CLOUD_ALT_M * 1.5);
	});

	it('picks a weather whose deck is thick enough to read as a floor', () => {
		// A scattered deck reads as haze from above, not as ground.
		const w = WEATHER_EFFECTS[middayCloudsShow.opening.weather];
		expect(w.cloudDensityRange[0]).toBeGreaterThanOrEqual(0.7);
	});

	it('picks a weather that does NOT dim the scene or wet the glass', () => {
		// THE reason this is `cloudy` and not `overcast`. Overcast is the
		// denser deck but carries rainOpacity 0.18 and filterBrightness 0.9 —
		// the view from inside weather. Above it, the sky must be left alone.
		const w = WEATHER_EFFECTS[middayCloudsShow.opening.weather];
		expect(w.rainOpacity).toBe(0);
		expect(w.filterBrightness).toBe(1);
	});

	it('is actually in the rotation', () => {
		// night-clouds is the cautionary case: authored, correct, and excluded,
		// so the `clouds` location never played at all until this show.
		expect(DAILY_ROTATION.map((s) => s.id)).toContain('midday-clouds');
	});
});
