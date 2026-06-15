/**
 * Public surface of the palettes content module.
 *
 * Import from `$content/palettes`:
 *   import { SKY_PALETTE, CAR_LIGHTS_PALETTE } from '$content/palettes';
 */

export { SKY_PALETTE, type SkyPaletteEntry } from './sky';
export { CAR_LIGHTS_PALETTE, type LightClass } from './car-lights';
export {
	CITY_SODIUM,
	CITY_AMBER,
	CITY_WARM_WHITE,
	CITY_COOL_LED,
	CITY_GLOW,
	STREET_CORE,
	STREET_HALO,
	hexOf,
	type Rgb,
} from './city-lights';
