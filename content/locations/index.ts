/**
 * Public surface of the locations content module.
 *
 * Consumers import from `$content/locations`:
 *   import { LOCATIONS, LOCATION_MAP, type LocationId } from '$content/locations';
 *
 * Growing a location means editing `catalog.ts`. No other file edits.
 */

export {
	LOCATIONS,
	LOCATION_IDS,
	LOCATION_MAP,
	isValidLocation,
	groundAltM,
	type Location,
	type LocationId,
	type SceneDefaults,
} from './catalog';
