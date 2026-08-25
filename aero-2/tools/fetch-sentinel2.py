#!/usr/bin/env python3
"""
Build a cloudless satellite basemap for one location, from Sentinel-2 on AWS.

    python3 tools/fetch-sentinel2.py hyderabad
    python3 tools/fetch-sentinel2.py denver --max-zoom 14

Why this exists
---------------
GIBS MODIS is a same-day swath at 250 m, capped at z9. Above ~6 km the ground
is an upscaled blur, and in monsoon season it is solid cloud. Sentinel-2 is
10 m and, picked by date, genuinely cloudless.

Licence is the other half. The EOX s2cloudless service is CC BY-NC-SA, which
does NOT cover a paid installation. This reads the SAME Sentinel-2 data from
the public `sentinel-cogs` bucket, which carries the Copernicus licence and
does permit commercial use. That is the whole reason for the extra steps.

How it picks a scene
--------------------
The orbit is an ellipse ~0.25 deg tall and ~0.425 deg wide, and the camera sees
well past it, so a single 110 km Sentinel-2 tile does not cover a location —
for Hyderabad the orbit runs ~11 km outside the west edge of 44QKE.

So: compute the bbox the flight can actually see, ask STAC which MGRS tiles
intersect it, and require ONE acquisition date that is clear across every one
of them. A per-tile "best" date would mosaic different seasons together and
show as colour steps at the tile seams.

Every asset URL comes from the STAC response. Do not reconstruct S3 paths by
hand — the month is not zero-padded, and guessing it yields a 404 that looks
like missing data.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

STAC = "https://earth-search.aws.element84.com/v1/search"

# Shortcuts only — --lat/--lon works for anywhere and is the general path.
#
# The first two mirror aero-2's src/lib/settings/locations.ts; the rest are v1's
# content/locations/catalog.ts, which is the catalog that actually ships. Kept
# as plain numbers rather than parsed out of either TypeScript file: this is an
# offline build step run by hand, and a parser for two differently-shaped
# catalogs is more code than the entries it would read.
#
# `ocean` (Pacific) is deliberately absent: Sentinel-2 does not produce scenes
# over open water, so no date covers it at any cloud threshold. Open water also
# has no 10 m texture to gain. Leave that show on the MODIS basemap.
PLACES = {
    "hyderabad": (17.4435, 78.3772),
    "denver": (39.8561, -104.6737),
    "dubai": (25.2048, 55.2708),
    "mumbai": (19.076, 72.8777),
    "dallas": (32.7767, -96.797),
    "phoenix": (33.4352, -112.0101),
    "las_vegas": (36.1699, -115.1398),
    "chicago_midway": (41.7868, -87.7522),
    "himalayas": (27.9881, 86.925),
    "desert": (23.4241, 25.6628),
    "clouds": (35.6762, 139.6503),
}

# From ORBIT in src/lib/display/flight/orbit.ts: majorMax 0.25 deg of latitude,
# aspect 1.7 east-west. VIEW_MARGIN_DEG is how far past its own ground track
# the camera can see at the 13 km ceiling.
ORBIT_MAJOR_DEG = 0.25
ORBIT_ASPECT = 1.7
VIEW_MARGIN_DEG = 0.4

# Sentinel-2 is 10 m. At z14 a web-mercator pixel is 9.55 m, so z14 is the last
# zoom backed by real source pixels; beyond it the tiles are upscaling and cost
# storage for no detail. Deliberately not raised.
DEFAULT_MAX_ZOOM = 14
DEFAULT_MIN_ZOOM = 8
Z14_RES = 156543.03392804097 / 2**14

R = 6378137.0


def mercator(lon: float, lat: float) -> tuple[float, float]:
    x = R * math.radians(lon)
    y = R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def view_bbox(lat: float, lon: float) -> list[float]:
    dlat = ORBIT_MAJOR_DEG + VIEW_MARGIN_DEG
    dlon = ORBIT_MAJOR_DEG * ORBIT_ASPECT + VIEW_MARGIN_DEG
    return [lon - dlon, lat - dlat, lon + dlon, lat + dlat]


def post(body: dict, attempts: int = 4) -> dict:
    """STAC 502s under load; retry rather than lose the whole sweep."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(STAC, data=data, headers={"Content-Type": "application/json"})
    for i in range(attempts):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=60).read())
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(3 * (i + 1))
    raise AssertionError("unreachable")


# A scene at the edge of the satellite swath fills only a sliver of its MGRS
# tile; the rest is nodata. Such a scene must never be chosen, and it is
# actively attractive to a naive picker: eo:cloud_cover is measured over VALID
# pixels only, so a tile that is 98.79% empty reports ~0% cloud and looks like
# the clearest thing available. Ranking on cloud alone selects the emptiest
# scene on offer, every time, and the mosaic comes out as black wedges.
MAX_NODATA_PCT = 5.0


def pick_date(bbox: list[float], start: str, end: str, max_cloud: float):
    """The clearest single date that covers every MGRS tile over the bbox.

    Each (date, MGRS tile) usually has TWO acquisitions from adjacent orbits.
    Rank them by nodata first and cloud second, never cloud alone.
    """
    by_date: dict[str, dict[str, tuple[float, float, str]]] = defaultdict(dict)
    for page in range(1, 8):
        r = post({
            "collections": ["sentinel-2-l2a"],
            "bbox": bbox,
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
            "query": {"eo:cloud_cover": {"lt": max_cloud}},
            "limit": 50,
            "page": page,
        })
        feats = r.get("features", [])
        for f in feats:
            mgrs = f["id"].split("_")[1]
            day = f["properties"]["datetime"][:10]
            cloud = f["properties"]["eo:cloud_cover"]
            nodata = f["properties"].get("s2:nodata_pixel_percentage", 0.0)
            if nodata > MAX_NODATA_PCT:
                continue
            prev = by_date[day].get(mgrs)
            if prev is None or (nodata, cloud) < (prev[0], prev[1]):
                by_date[day][mgrs] = (nodata, cloud, f["assets"]["visual"]["href"])
        if len(feats) < 50:
            break

    grids = {m for v in by_date.values() for m in v}
    if not grids:
        sys.exit("No Sentinel-2 scenes at all for that bbox and window.")

    complete = [(max(c for _, c, _ in v.values()), d, v)
                for d, v in by_date.items() if set(v) == grids]
    if not complete:
        print(f"MGRS tiles needed: {sorted(grids)}", file=sys.stderr)
        sys.exit(
            "No single date covers every tile under this cloud threshold.\n"
            "Widen --max-cloud or the date window. Do NOT mosaic per-tile best\n"
            "dates: different seasons meet as visible colour steps at the seams."
        )
    worst, day, tiles = sorted(complete)[0]
    return day, worst, sorted(grids), tiles


def run(cmd: list[str]) -> None:
    print("  $", " ".join(cmd[:6]), "..." if len(cmd) > 6 else "", flush=True)
    subprocess.run(cmd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("place", help="a name from PLACES, or any label when --lat/--lon are given")
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lon", type=float)
    ap.add_argument("--start", default="2026-01-01")
    ap.add_argument("--end", default="2026-06-30")
    ap.add_argument("--max-cloud", type=float, default=5.0)
    ap.add_argument("--min-zoom", type=int, default=DEFAULT_MIN_ZOOM)
    ap.add_argument("--max-zoom", type=int, default=DEFAULT_MAX_ZOOM)
    ap.add_argument("--out", default="data/tiles")
    a = ap.parse_args()

    if a.max_zoom > DEFAULT_MAX_ZOOM:
        print(f"! z{a.max_zoom} upscales: Sentinel-2 is 10 m and z14 is 9.55 m/px.",
              file=sys.stderr)

    if a.lat is not None and a.lon is not None:
        lat, lon = a.lat, a.lon
    elif a.place in PLACES:
        lat, lon = PLACES[a.place]
    else:
        sys.exit(f"unknown place {a.place!r}; pass --lat/--lon, or use one of: "
                 + ", ".join(sorted(PLACES)))
    bbox = view_bbox(lat, lon)
    print(f"{a.place}: visible bbox {[round(v, 3) for v in bbox]}")

    day, worst, grids, tiles = pick_date(bbox, a.start, a.end, a.max_cloud)
    print(f"date {day}: {len(grids)} MGRS tiles, worst cloud {worst:.2f}%")

    work = Path(a.out) / f"_s2-{a.place}"
    work.mkdir(parents=True, exist_ok=True)

    # Warp each scene to web mercator on the z14 pixel grid, so gdal2tiles never
    # resamples a second time.
    #
    # Deliberately NOT cropped to the bbox with -te. Each scene covers only its
    # own corner of it, so -te made twelve full-bbox grids that were mostly
    # nodata — about twice the total pixels, for padding the mosaic discards.
    # -tap keeps every output on the same grid, which is all gdalbuildvrt needs
    # to stitch rasters of differing extents.
    #
    # Run in parallel: each warp is network-bound on a remote COG, so they
    # overlap almost perfectly. Sequentially this stage took ~5 min per scene.
    def warp(item):
        i, (mgrs, (nodata, cloud, href)) = item
        dst = work / f"{mgrs}.tif"
        if dst.exists():
            print(f"[{i}/{len(tiles)}] {mgrs} cached", flush=True)
            return str(dst)
        print(f"[{i}/{len(tiles)}] {mgrs} cloud {cloud:.2f}% ...", flush=True)
        subprocess.run([
            "gdalwarp", "-q",
            "-t_srs", "EPSG:3857",
            "-tr", str(Z14_RES), str(Z14_RES), "-tap",
            "-r", "cubic",
            "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES",
            "-wo", "NUM_THREADS=2",
            "--config", "GDAL_CACHEMAX", "512",
            "--config", "AWS_NO_SIGN_REQUEST", "YES",
            "--config", "GDAL_HTTP_MAX_RETRY", "5",
            "--config", "GDAL_HTTP_RETRY_DELAY", "2",
            f"/vsicurl/{href}", str(dst),
        ], check=True)
        print(f"[{i}/{len(tiles)}] {mgrs} done", flush=True)
        return str(dst)

    with ThreadPoolExecutor(max_workers=6) as pool:
        warped = list(pool.map(warp, enumerate(sorted(tiles.items()), 1)))

    vrt = work / "mosaic.vrt"
    # NO -addalpha. An alpha band forces gdal2tiles to emit PNG, which for a
    # photographic basemap is several times the bytes of JPEG for no visible
    # gain, and breaks the .jpg convention /api/tiles already serves. The 12
    # MGRS scenes tile the bbox contiguously, so there is no interior nodata
    # for alpha to protect — only the outer rim, which the camera never reaches.
    run(["gdalbuildvrt", "-q", str(vrt), *warped])

    # One flat layer dir for every place, NOT sentinel2/<place>/. Two reasons:
    # `pack-pmtiles.ts <layer>` and /api/tiles both expect layer/{z}/{x}/{y},
    # and separate archives per city would mean per-place routing in the app
    # for no gain. Cities this far apart share no tile at z8-14, so running
    # this for a second place merges into the same tree without collision.
    tiles_dir = Path(a.out) / "sentinel2"
    print(f"tiling z{a.min_zoom}-{a.max_zoom} -> {tiles_dir}")
    run([
        "gdal2tiles.py", "--xyz", "-w", "none", "--processes", "8",
        "--tiledriver", "JPEG", "--jpeg-quality", "85",
        "-z", f"{a.min_zoom}-{a.max_zoom}", "-r", "cubic",
        str(vrt), str(tiles_dir),
    ])

    meta = {"place": a.place, "date": day, "mgrs": grids,
            "worstCloudPct": round(worst, 3), "bbox": bbox,
            "minZoom": a.min_zoom, "maxZoom": a.max_zoom,
            "licence": "Copernicus Sentinel data — commercial use permitted"}
    (tiles_dir / f"source-{a.place}.json").write_text(json.dumps(meta, indent=1))
    print(f"done. {tiles_dir}/source-{a.place}.json records the scene and licence.")
    print(f"next: bun tools/pack-pmtiles.ts sentinel2 data/tiles/sentinel2.pmtiles")
    print(f"the warp scratch in {work} is safe to delete once packed.")


if __name__ == "__main__":
    main()
