export type SkyState = 'day' | 'night' | 'dawn' | 'dusk';
export type LocationId = 'dubai' | 'himalayas' | 'mumbai' | 'ocean' | 'desert' | 'clouds' | 'hyderabad' | 'dallas' | 'phoenix' | 'las_vegas' | 'denver' | 'chicago_midway' | 'baltimore' | 'houston' | 'nashville' | 'oakland' | 'austin' | 'atlanta';
export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'overcast' | 'storm';

export interface Location {
	id: LocationId;
	name: string;
	lat: number;
	lon: number;
	utcOffset: number;
	hasBuildings: boolean;
	defaultAltitude: number;
	nightAltitude: number;
}
