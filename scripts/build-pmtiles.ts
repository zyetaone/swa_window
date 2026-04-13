#!/usr/bin/env bun

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname, relative } from 'path';
import PMTiles from 'pmtiles';

const PUBLIC_TILES = join(process.cwd(), 'public', 'tiles');
const OUTPUT_DIR = join(process.cwd(), 'public', 'pmtiles');

interface ManifestEntry {
  source: string;
  locationId: string;
  pmtilesPath: string;
  zoomLevels: number[];
  tileCount: number;
  bytes: number;
}

interface Manifest {
  generated: string;
  pmtiles: ManifestEntry[];
}

function latToTile(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, z);
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
}

function lonToTile(lon: number, z: number): number {
  const n = Math.pow(2, z);
  return Math.floor(((lon + 180) / 360) * n);
}

function countTiles(tileDir: string): number {
  if (!existsSync(tileDir)) return 0;
  let total = 0;
  try {
    const xDirs = readdirSync(tileDir);
    for (const x of xDirs) {
      const xPath = join(tileDir, x);
      if (statSync(xPath).isDirectory()) {
        total += readdirSync(xPath).filter(f => f.endsWith('.jpg')).length;
      }
    }
  } catch {}
  return total;
}

async function buildPmtiles(
  tileDir: string,
  pmtPath: string,
  onProgress: (msg: string) => void
): Promise<{ tileCount: number; bytes: number } | null> {
  if (existsSync(pmtPath)) {
    unlinkSync(pmtPath);
  }

  const archive = new PMTiles.Writer(pmtPath);

  const zDirs = readdirSync(tileDir).filter(f => !f.startsWith('.'));
  let tileCount = 0;
  let bytes = 0;

  for (const zStr of zDirs) {
    const zPath = join(tileDir, zStr);
    if (!statSync(zPath).isDirectory()) continue;
    const z = parseInt(zStr);

    const xDirs = readdirSync(zPath);
    for (const xStr of xDirs) {
      const xPath = join(zPath, xStr);
      if (!statSync(xPath).isDirectory()) continue;
      const x = parseInt(xStr);

      const tiles = readdirSync(xPath).filter(f => f.endsWith('.jpg'));
      for (const tile of tiles) {
        const yStr = tile.replace('.jpg', '');
        const y = parseInt(yStr);

        const tilePath = join(xPath, tile);
        const data = readFileSync(tilePath);
        bytes += data.length;

        const header = PMTiles.makeTileHeader(z, x, y, data.length);
        await archive.addTile(header, data);
        tileCount++;
      }
    }

    if (tileCount % 500 === 0) {
      onProgress(`  z${z}: ${tileCount} tiles written`);
    }
  }

  await archive.finalize();

  return { tileCount, bytes };
}

async function main() {
  console.log('=== PMTiles Builder ===\n');

  if (!existsSync(PUBLIC_TILES)) {
    console.error('No tiles found. Run `bun scripts/prefetch-tiles.ts` first.');
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const sources = ['esri'];
  const entries: ManifestEntry[] = [];

  const locations = readdirSync(PUBLIC_TILES).filter(s => {
    try {
      return statSync(join(PUBLIC_TILES, s)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const source of sources) {
    const sourceDir = join(PUBLIC_TILES, source);
    if (!existsSync(sourceDir)) continue;

    for (const locationId of locations) {
      const locationDir = join(sourceDir, locationId);
      if (!existsSync(locationDir)) continue;

      const zoomLevels: number[] = [];
      let totalTileCount = 0;

      for (const z of readdirSync(locationDir)) {
        const zPath = join(locationDir, z);
        if (!statSync(zPath).isDirectory()) continue;
        const count = countTiles(zPath);
        if (count > 0) {
          zoomLevels.push(parseInt(z));
          totalTileCount += count;
        }
      }

      if (zoomLevels.length === 0) continue;

      const pmtLabel = `${source}_${locationId}`;
      const pmtPath = join(OUTPUT_DIR, `${pmtLabel}.pmtiles`);

      console.log(`\n[${source}] ${locationId}`);
      console.log(`  Zoom levels: ${zoomLevels.join(', ')}`);
      console.log(`  Total tiles: ${totalTileCount}`);

      const result = await buildPmtiles(
        locationDir,
        pmtPath,
        msg => console.log(msg)
      );

      if (!result) continue;

      entries.push({
        source,
        locationId,
        pmtilesPath: relative(process.cwd(), pmtPath),
        zoomLevels,
        tileCount: result.tileCount,
        bytes: result.bytes,
      });

      const sizeMB = (result.bytes / 1024 / 1024).toFixed(2);
      console.log(`  Done: ${result.tileCount} tiles, ${sizeMB} MB → ${pmtLabel}.pmtiles`);
    }
  }

  const manifest: Manifest = {
    generated: new Date().toISOString(),
    pmtiles: entries,
  };

  const manifestPath = join(OUTPUT_DIR, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('\n=== Manifest ===');
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
