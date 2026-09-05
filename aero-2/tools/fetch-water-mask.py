#!/usr/bin/env python3
"""
Build a water mask for one location, from Sentinel-2's Scene Classification.

    python3 tools/fetch-water-mask.py chicago_midway

Why a mask
----------
MapLibre draws a PHOTOGRAPH of water. Cesium drew water as a SURFACE — a normal
map plus a light vector — which is why v1 shimmered and aero-2 reads flat. No
amount of raster grading recovers that: the grade operates on a still image.

A shader layer can, but it needs to know WHERE the water is. Terrarium carries
no water bit (that is why v1 needed Cesium's quantized-mesh `requestWaterMask`),
so the mask has to come from somewhere else.

It comes free with the imagery. Every Sentinel-2 L2A scene ships an `SCL`
asset — the Scene Classification Layer — alongside the `visual` (TCI) that
fetch-sentinel2.py already pulls. Class 6 is water. It is a classifier output,
so it beats a hand-thresholded NDWI and costs no extra bands.

This is the same layer system VIIRS night-lights already uses: a second raster
composited over the base, mounted only where it is packed. Nothing new
architecturally — one more mask in the stack.

Why its own date
----------------
The mask does NOT reuse the visual's acquisition date, and that is deliberate.
fetch-sentinel2.py picks a date for LOW CLOUD, which in temperate latitudes
often lands in winter. Measured on Chicago's actual packed scene
(16TDM, 2026-02-25): 3.1% water, 87.8% nodata, with snow and ice on the lake.
The same MGRS tile on 2026-08-22 reads 49.4% water and 0% nodata.

A winter date is right for the photograph and wrong for the mask. Coastlines do
not move between seasons, so the two can be decoupled: this picks a LEAF-ON,
ice-free window independently, which is why --start/--end default to summer.

Output
------
`data/tiles/water/{z}/{y}/{x}.png` — 8-bit alpha, 255 where water. Served by
the same /api/tiles/xyz route as every other layer, so nothing server-side
changes. PNG not JPEG: a mask must not carry compression ringing at the shore.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

STAC = "https://earth-search.aws.element84.com/v1/search"

# SCL class 6 == water. The full enum lives in the Sentinel-2 L2A product spec;
# only this one matters here.
SCL_WATER = 6

# Same 10 m grid the visual pack warps to, so mask and imagery register exactly.
Z14_RES = 9.554628535647032

# Ice, snow and low winter sun all defeat the water classifier. Default to a
# northern-hemisphere summer window; --start/--end override for the south.
DEFAULT_START = "07-01"
DEFAULT_END = "09-15"


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def stac_search(body: dict, attempts: int = 4) -> list[dict]:
    """One STAC query, retried.

    The sibling tool already learned this — `fetch-sentinel2.py:post` carries
    the comment "STAC 502s under load; retry rather than lose the whole sweep"
    — and this one did not, so a single Bad Gateway killed a run outright after
    it had already spent minutes warping. Observed on Hyderabad: HTTP 502 from
    earth-search, traceback, nothing packed.

    Same shape as the sibling deliberately: 4 attempts, linear 3 s backoff. Not
    factored into a shared module because these two scripts are run by hand,
    independently, and a tools/ package for one function would cost more than
    it saves.
    """
    req = urllib.request.Request(
        STAC, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)["features"]
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(3 * (i + 1))
    raise AssertionError("unreachable")


def pick_scenes(bbox: list[float], start: str, end: str, max_cloud: float) -> dict[str, str]:
    """One SCL href per MGRS tile — the clearest in the window.

    Unlike the visual pack, this does NOT require a single shared date across
    every tile. The visual needs one date because different seasons mosaic into
    visible colour steps at the seams. A mask has no colour: it is a binary
    class, so per-tile best-date is not only allowed but strictly better
    coverage. That is the one place this tool may diverge from its sibling.
    """
    # Paginated at 100, not one shot at 500.
    #
    # `limit: 500` 502s outright on a large bbox. Reproduced against
    # earth-search with Hyderabad's real box [77.55, 16.79, 79.20, 18.09]:
    # limit=500 gives HTTP 502 every time, limit=100 returns 100 features and a
    # link to the next page. It is not load and it is not transient, so the
    # retry added alongside this fix could never have helped — four attempts at
    # an impossible request is still zero results, just slower.
    #
    # The sibling packer already pages (`fetch-sentinel2.py`, 50 at a time, up
    # to 7 pages). This does the same, and stops when a short page says the
    # results are exhausted.
    feats: list[dict] = []
    for page in range(1, 12):
        chunk = stac_search({
            "collections": ["sentinel-2-l2a"],
            "bbox": bbox,
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
            "query": {"eo:cloud_cover": {"lt": max_cloud}},
            "limit": 100,
            "page": page,
        })
        feats.extend(chunk)
        if len(chunk) < 100:
            break
    best: dict[str, tuple[float, str]] = {}
    for f in feats:
        p = f["properties"]
        mgrs = "{}{}{}".format(
            p["mgrs:utm_zone"], p["mgrs:latitude_band"], p["mgrs:grid_square"]
        )
        cloud = p.get("eo:cloud_cover", 100.0)
        nodata = p.get("s2:nodata_pixel_percentage", 0.0)
        # Rank on nodata first: a scene that does not cover the tile is useless
        # however clear it is. Same ordering the visual packer settled on.
        score = (nodata, cloud)
        if mgrs not in best or score < best[mgrs][0]:
            best[mgrs] = (score, f["assets"]["scl"]["href"])
    return {k: v[1] for k, v in best.items()}


def water_fraction(path: Path) -> float | None:
    """What fraction of a written mask is actually water.

    The same trap as the visual packer: gdalwarp can exhaust its HTTP retries,
    write a correctly-shaped all-zero raster, and still exit 0. For a MASK an
    all-zero result is indistinguishable from "no water here" by shape alone,
    so it must be measured, not assumed.

    Read the LAST band, not the first. The output is RGBA with band 1 copied
    into R, G, B and A, and `-a_nodata none` leaves R at a constant 255 in the
    written file — so taking the first STATISTICS_MEAN reported 100% water for
    every tile, including ones that are 4.6% water, and the all-zero guard
    above could never fire. Chicago's manifest shipped `waterFraction: 1.0`
    from exactly this. Alpha is the only band that carries coverage.
    """
    r = subprocess.run(["gdalinfo", "-stats", str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    means = re.findall(r"STATISTICS_MEAN=([0-9.]+)", r.stdout)
    return float(means[-1]) / 255.0 if means else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("place", help="must already have data/tiles/sentinel2/source-<place>.json")
    ap.add_argument("--out", default="data/tiles")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--start", default=None, help="YYYY-MM-DD (default: this year's summer)")
    ap.add_argument("--end", default=None)
    ap.add_argument("--max-cloud", type=float, default=15.0)
    ap.add_argument("--min-zoom", type=int, default=8)
    ap.add_argument("--max-zoom", type=int, default=13)
    a = ap.parse_args()

    # The visual manifest is the SSOT for the box. Re-deriving the bbox here
    # would let mask and imagery drift apart silently.
    manifest = Path(a.out) / "sentinel2" / f"source-{a.place}.json"
    if not manifest.exists():
        sys.exit(
            f"no {manifest}.\n"
            "The mask is registered against a packed visual layer, so pack the "
            "imagery first:\n"
            f"    python3 tools/fetch-sentinel2.py {a.place}"
        )
    meta = json.loads(manifest.read_text())
    bbox = meta["bbox"]

    start = a.start or f"{a.year}-{DEFAULT_START}"
    end = a.end or f"{a.year}-{DEFAULT_END}"

    print(f"{a.place}: bbox {bbox}")
    print(f"searching SCL {start}..{end} at <{a.max_cloud}% cloud")
    scenes = pick_scenes(bbox, start, end, a.max_cloud)
    if not scenes:
        sys.exit("no scenes matched — widen --start/--end or raise --max-cloud")
    print(f"{len(scenes)} MGRS tiles")

    work = Path(a.out) / "_water-work" / a.place
    work.mkdir(parents=True, exist_ok=True)

    def build(item: tuple[int, tuple[str, str]]) -> str:
        i, (mgrs, href) = item
        dst = work / f"{mgrs}.tif"
        if dst.exists() and water_fraction(dst) is not None:
            print(f"[{i}/{len(scenes)}] {mgrs} cached", flush=True)
            return str(dst)
        print(f"[{i}/{len(scenes)}] {mgrs} ...", flush=True)
        raw = work / f"{mgrs}-scl.tif"
        run([
            "gdalwarp", "-q", "-t_srs", "EPSG:3857",
            "-tr", str(Z14_RES), str(Z14_RES), "-tap",
            # NEAREST, not cubic. SCL pixels are class NUMBERS: interpolating
            # between class 5 (bare) and 7 (unclassified) invents class 6 and
            # paints water along every shoreline that has none.
            "-r", "near",
            "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES",
            "--config", "AWS_NO_SIGN_REQUEST", "YES",
            "--config", "GDAL_HTTP_MAX_RETRY", "20",
            "--config", "GDAL_HTTP_RETRY_DELAY", "5",
            f"/vsicurl/{href}", str(raw),
        ])
        # Reclass to 0/255 via a VRT lookup table, NOT gdal_calc.
        #
        # gdal_calc.py imports osgeo.gdal_array, which needs the numpy that the
        # GDAL bindings were compiled against. On a Homebrew box tracking two
        # Pythons that is routinely not the numpy on the path, and the failure
        # is an ImportError at run time — after the expensive warp. A <LUT> is
        # evaluated inside GDAL's C++ core with no Python numeric stack at all,
        # so this stage cannot break that way.
        #
        # The knots are exact at every integer, which is all a Byte raster can
        # hold: 6 maps to 255, its neighbours 5 and 7 to 0. Linear
        # interpolation between knots is therefore never actually exercised.
        lut = work / f"{mgrs}-mask.vrt"
        run(["gdal_translate", "-q", "-of", "VRT", str(raw), str(lut)])
        text = lut.read_text().replace(
            "<ComplexSource>",
            "<ComplexSource><LUT>0:0,5:0,6:255,7:0,255:0</LUT>", 1
        )
        # gdal_translate emits <SimpleSource> for a plain copy; a LUT is only
        # honoured on <ComplexSource>, so promote it when that is what we got.
        if "<LUT>" not in text:
            text = (text.replace("<SimpleSource>", "<ComplexSource>")
                        .replace("</SimpleSource>", "</ComplexSource>")
                        .replace("<ComplexSource>",
                                 "<ComplexSource><LUT>0:0,5:0,6:255,7:0,255:0</LUT>", 1))
        lut.write_text(text)
        run([
            "gdal_translate", "-q", "-ot", "Byte", "-a_nodata", "none",
            # RGBA, not a 1-band mask. MapLibre v6 has NO `raster-color`
            # property (checked in the shipped bundle), so a grey mask cannot
            # be tinted at paint time and would draw its black land as black
            # over the map. Expanding here makes the ZERO pixels transparent
            # and the water pixels opaque white, which composites correctly
            # with nothing but `raster-opacity`.
            #
            # Band 1 four times: RGB all take the mask, so water is white and
            # land is black-but-fully-transparent. Only alpha is ever read for
            # coverage; the white is what carries the sheen colour.
            "-b", "1", "-b", "1", "-b", "1", "-b", "1",
            "-colorinterp", "red,green,blue,alpha",
            "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES",
            str(lut), str(dst),
        ])
        raw.unlink(missing_ok=True)
        lut.unlink(missing_ok=True)
        frac = water_fraction(dst)
        print(f"[{i}/{len(scenes)}] {mgrs} {100 * (frac or 0):.1f}% water", flush=True)
        return str(dst)

    with ThreadPoolExecutor(max_workers=6) as pool:
        built = list(pool.map(build, enumerate(sorted(scenes.items()), 1)))

    vrt = work / "water.vrt"
    run(["gdalbuildvrt", "-q", "-te", *[str(v) for v in _merc_te(bbox)], str(vrt), *built])

    total = water_fraction(Path(vrt))
    if total is not None:
        print(f"mosaic is {100 * total:.1f}% water")
        if total < 0.001:
            print("! essentially no water found. If this location HAS water, the "
                  "window is probably wrong — ice and low sun defeat the "
                  "classifier. Try --start/--end in local summer.")

    tiles_dir = Path(a.out) / "water"
    staging = work / "tiles"
    print(f"tiling z{a.min_zoom}-{a.max_zoom} -> {tiles_dir}")
    run([
        "gdal2tiles.py", "--xyz", "-w", "none", "--processes", "8",
        "--tiledriver", "PNG",
        "-z", f"{a.min_zoom}-{a.max_zoom}", "-r", "near",
        str(vrt), str(staging),
    ])
    _transpose(tiles_dir, a.min_zoom, a.max_zoom, staging)

    out_meta = {
        "place": a.place, "window": [start, end], "mgrs": sorted(scenes),
        "waterFraction": round(total or 0.0, 4), "bbox": bbox,
        "minZoom": a.min_zoom, "maxZoom": a.max_zoom,
        "source": "Sentinel-2 L2A Scene Classification (SCL) class 6",
        "licence": "Copernicus Sentinel data — commercial use permitted",
    }
    (tiles_dir / f"source-{a.place}.json").write_text(json.dumps(out_meta, indent=1))
    print(f"done. {tiles_dir}/source-{a.place}.json records the window and licence.")
    print(f"next: add '{a.place}' to WATER_PLACES in src/lib/settings/tiles.ts")


def _merc_te(bbox: list[float]) -> tuple[float, float, float, float]:
    import math
    def m(lon: float, lat: float) -> tuple[float, float]:
        x = lon * 20037508.34 / 180.0
        y = math.log(math.tan((90 + lat) * math.pi / 360.0)) / (math.pi / 180.0)
        return x, y * 20037508.34 / 180.0
    x0, y0 = m(bbox[0], bbox[1])
    x1, y1 = m(bbox[2], bbox[3])
    return x0, y0, x1, y1


def _transpose(dest: Path, zmin: int, zmax: int, staging: Path) -> None:
    """gdal2tiles writes {z}/{x}/{y}; /api/tiles serves {z}/{y}/{x}.

    Same flip fetch-sentinel2.py needs, and the same reason it stages first:
    the shared layer tree holds every place ALREADY in served order, so
    re-walking it would flip tiles an earlier run had put right.
    """
    for z in range(zmin, zmax + 1):
        src = staging / str(z)
        if not src.is_dir():
            continue
        for xd in src.iterdir():
            if not xd.is_dir():
                continue
            for tile in xd.iterdir():
                if tile.suffix != ".png":
                    continue
                out = dest / str(z) / tile.stem / f"{xd.name}.png"
                out.parent.mkdir(parents=True, exist_ok=True)
                tile.replace(out)


if __name__ == "__main__":
    main()
