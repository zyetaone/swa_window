#!/usr/bin/env bun
/**
 * Tile Packager CLI
 *
 * Downloads map tiles for offline Pi 5 kiosk deployment.
 *
 * Usage:
 *   bun run tile-packager --locations dubai,dallas --output ./tiles
 *   bun run tile-packager --locations all --output ./tiles
 *   bun run tile-packager --locations all --estimate  (dry run, show storage estimate)
 */

import { LOCATIONS } from '@zyeta/shared';
import type { LocationId } from '@zyeta/shared';
import { generateTileSpecs, estimateStorage } from './rules';
import { packageTiles } from './actions/package';

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

function parseArgs(): { locations: LocationId[] | 'all'; output: string; estimate: boolean } {
	const args = process.argv.slice(2);
	let locations: LocationId[] | 'all' = 'all';
	let output = './tiles';
	let estimate = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--locations' && args[i + 1]) {
			const val = args[i + 1];
			locations = val === 'all' ? 'all' : val.split(',') as LocationId[];
			i++;
		} else if (args[i] === '--output' && args[i + 1]) {
			output = args[i + 1];
			i++;
		} else if (args[i] === '--estimate') {
			estimate = true;
		} else if (args[i] === '--help' || args[i] === '-h') {
			console.log(`
Tile Packager — Download map tiles for offline Pi 5 kiosk deployment

Usage:
  bun run src/index.ts [options]

Options:
  --locations <ids>   Comma-separated location IDs, or "all" (default: all)
  --output <dir>      Output directory (default: ./tiles)
  --estimate          Dry run: show storage estimates without downloading
  --help              Show this help

Available locations:
  ${LOCATIONS.map(l => `${l.id} (${l.name})`).join('\n  ')}
`);
			process.exit(0);
		}
	}

	return { locations, output, estimate };
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
	const { locations, output, estimate } = parseArgs();

	const locationIds = locations === 'all'
		? undefined
		: locations;

	const specs = generateTileSpecs(locationIds);

	if (specs.length === 0) {
		console.error('No valid locations found.');
		process.exit(1);
	}

	console.log(`\n=== Tile Packager ===`);
	console.log(`Locations: ${specs.map(s => s.name).join(', ')}`);
	console.log(`Output:    ${output}`);
	console.log('');

	// Storage estimate
	const est = estimateStorage(specs);
	console.log('Storage Estimate:');
	for (const [locId, stats] of est.perLocation) {
		console.log(`  ${locId}: ${stats.tiles.toLocaleString()} tiles, ~${(stats.bytes / 1024 / 1024).toFixed(0)} MB`);
	}
	if (est.global.tiles > 0) {
		console.log(`  [global]: ${est.global.tiles.toLocaleString()} tiles, ~${(est.global.bytes / 1024 / 1024).toFixed(0)} MB`);
	}
	console.log(`  TOTAL: ${est.total.tiles.toLocaleString()} tiles, ~${(est.total.bytes / 1024 / 1024).toFixed(0)} MB`);

	if (estimate) {
		console.log('\n(Dry run — no tiles downloaded)');
		return;
	}

	// Download
	const startTime = Date.now();
	await packageTiles(specs, output);
	const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
	console.log(`\nCompleted in ${elapsed} minutes.`);
}

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
