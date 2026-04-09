/**
 * Re-export of shared location registry. SSOT lives in `$lib/shared/locations`.
 * Kept here so existing `./locations` relative imports inside `core/`
 * continue to work without path changes.
 */
export { LOCATIONS, LOCATION_IDS, LOCATION_MAP } from '$lib/shared/locations';
