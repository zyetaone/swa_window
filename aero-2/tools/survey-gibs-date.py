#!/usr/bin/env python3
"""
survey-gibs-date — pick the day GIBS_DATE should be pinned to.

`src/lib/server/tiles.ts` tells you to "sweep candidates against every catalog
entry, discard any that is not 11/11, then take the lowest washed-out
percentage". That instruction shipped for months with nothing that could carry
it out, so the pin was set on coverage alone and 08-23 sat at 24.4% near-white
tiles: over Denver, a north-south band brightening with longitude — a MODIS
swath edge — that looked for all the world like a broken imagery grade.

Two bars, and they are not the same bar:

  COVERAGE  a day with no tile over a location renders a black void under a
            lit sky. This is a gate, not a score.
  CLARITY   a covered tile can still be solid cloud. MODIS true colour is a
            same-day swath, so this varies wildly day to day.

Usage (dates are what you want to compare; there is no default set, because
the right candidates depend on when you are reading this):

    python3 tools/survey-gibs-date.py 2026-06-15 2026-06-20 2026-08-23

Needs Pillow: `pip install pillow`. Not a repo dependency — it decodes JPEGs
for a one-off decision, and adding an image library to a kiosk's install to
support a script that runs twice a year is the wrong trade.
"""

import concurrent.futures as cf
import io
import math
import sys
import urllib.error
import urllib.request

try:
    from PIL import Image
except ImportError:
    sys.exit("needs Pillow: pip install pillow")

# Mirrors Location.CATALOG in src/lib/settings/locations.ts. Duplicated on
# purpose: this is a standalone script, and importing the TS catalog would mean
# a build step for a tool whose whole value is being runnable on its own.
# If a location is added there and not here, the sweep silently under-tests —
# so check both when the catalog changes.
LOCATIONS = [
    ("hyderabad", 17.4435, 78.3772),
    ("mumbai", 19.076, 72.8777),
    ("dubai", 25.2048, 55.2708),
    ("dallas", 32.7767, -96.797),
    ("phoenix", 33.4352, -112.0101),
    ("las_vegas", 36.1699, -115.1398),
    ("denver", 39.8561, -104.6737),
    ("chicago_midway", 41.7868, -87.7522),
    ("himalayas", 27.9881, 86.925),
    ("ocean", 21.3069, -157.8583),
    ("desert", 23.4241, 25.6628),
]

URL = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    "MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/"
    "GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg"
)

ZOOM = 8
# +/-2 tiles: at cruise the camera sees far past the orbit, so judging a day on
# the centre tile alone rates the one pixel the window spends least time over.
WINDOW = 2
# Mean luminance above which a tile is cloud rather than ground. Calibrated
# against tiles inspected by eye: clear Denver land sits near 82, solid cloud
# above 200.
WASHED_OUT = 170


def lonlat_to_tile(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180) / 360 * n)
    lat_rad = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n)
    return x, y


def fetch_luminance(job) -> tuple[str, str, float | None]:
    """Returns (location, status, mean luminance). status is ok | missing."""
    name, date, z, y, x = job
    try:
        with urllib.request.urlopen(URL.format(date=date, z=z, y=y, x=x), timeout=30) as r:
            image = Image.open(io.BytesIO(r.read())).convert("RGB")
    except urllib.error.HTTPError:
        return name, "missing", None
    except Exception:
        return name, "missing", None
    pixels = list(image.getdata())
    return name, "ok", sum(sum(p) / 3 for p in pixels) / len(pixels)


def survey(date: str) -> None:
    jobs = []
    for name, lat, lon in LOCATIONS:
        x, y = lonlat_to_tile(lat, lon, ZOOM)
        for dx in range(-WINDOW, WINDOW + 1):
            for dy in range(-WINDOW, WINDOW + 1):
                jobs.append((name, date, ZOOM, y + dy, x + dx))

    with cf.ThreadPoolExecutor(16) as pool:
        results = list(pool.map(fetch_luminance, jobs))

    gaps: dict[str, int] = {}
    values: list[float] = []
    for name, status, lum in results:
        if status != "ok":
            gaps[name] = gaps.get(name, 0) + 1
        else:
            values.append(lum)

    if not values:
        print(f"{date}  no data at all")
        return

    washed = 100 * sum(1 for v in values if v > WASHED_OUT) / len(values)
    covered = len(LOCATIONS) - len(gaps)
    verdict = "REJECT (coverage)" if gaps else "eligible"
    detail = ", ".join(f"{k}:{v} missing" for k, v in sorted(gaps.items())) or "none"
    print(
        f"{date}  {covered}/{len(LOCATIONS)} covered  "
        f"washed={washed:5.1f}%  mean={sum(values) / len(values):6.1f}  "
        f"{verdict}  gaps=[{detail}]"
    )


if __name__ == "__main__":
    dates = sys.argv[1:]
    if not dates:
        sys.exit(__doc__.strip().split("Usage")[1].strip())
    print(f"z{ZOOM}, +/-{WINDOW} tiles around each of {len(LOCATIONS)} locations")
    print("coverage is a GATE; clarity is the tiebreak\n")
    for d in dates:
        survey(d)
