#!/usr/bin/env python3
"""
build-schedule.py — generate schedule.json for the BVCTV transit board.

Reads Calgary Transit's static GTFS and extracts every scheduled CTrain
departure from City Hall / Bow Valley College, for both platforms.

USAGE
    1. Download "Calgary Transit Scheduling Data (GTFS)" from Open Calgary
    2. Unzip it into a folder
    3. python3 build-schedule.py /path/to/unzipped/gtfs
    4. Commit the resulting scripts/schedule.json

RE-RUN THIS whenever Calgary publishes a new schedule (roughly quarterly —
they revise service four times a year). The JSON carries its own validity
dates and the dashboard warns in the console when it goes out of date.
"""

import csv, json, sys, os, collections

STOP_WEST = "6822"   # WB City Hall/Bow Valley College
STOP_EAST = "6831"   # EB City Hall/Bow Valley College
CTRAIN_PREFIXES = ("201-", "202-")


def hms_to_seconds(t):
    """GTFS times can exceed 24h (e.g. 25:14:00 = 1:14am next day)."""
    parts = t.strip().split(":")
    if len(parts) != 3:
        return None
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        return None


def tidy(headsign):
    """SOMERSET-BRIDLEWOOD -> Somerset-Bridlewood, 69 ST STATION -> 69 St Station"""
    words = headsign.strip().title().split()
    fixed = []
    for w in words:
        if w.upper() in ("SW", "NW", "SE", "NE"):
            fixed.append(w.upper())
        else:
            fixed.append(w)
    return " ".join(fixed)


def main(gtfs_dir):
    def path(name):
        return os.path.join(gtfs_dir, name)

    for required in ("trips.txt", "stop_times.txt", "calendar.txt"):
        if not os.path.exists(path(required)):
            sys.exit("Missing %s in %s" % (required, gtfs_dir))

    # ---- calendar: which service_ids run on which weekdays -----------------
    calendar = {}
    valid_from, valid_to = None, None
    with open(path("calendar.txt"), newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            sid = r["service_id"]
            calendar[sid] = {
                "days": [int(r[d]) for d in ("sunday", "monday", "tuesday",
                                             "wednesday", "thursday",
                                             "friday", "saturday")],
                "start": r["start_date"],
                "end": r["end_date"],
            }
            valid_from = r["start_date"] if valid_from is None else min(valid_from, r["start_date"])
            valid_to = r["end_date"] if valid_to is None else max(valid_to, r["end_date"])

    # ---- calendar_dates: added/removed service on specific dates -----------
    exceptions = []
    cdpath = path("calendar_dates.txt")
    if os.path.exists(cdpath):
        with open(cdpath, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                exceptions.append({
                    "service": r["service_id"],
                    "date": r["date"],
                    "type": int(r["exception_type"]),  # 1 = added, 2 = removed
                })

    # ---- CTrain trips ------------------------------------------------------
    trips = {}
    with open(path("trips.txt"), newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["route_id"].startswith(CTRAIN_PREFIXES):
                trips[r["trip_id"]] = (
                    r["route_id"].split("-")[0],      # "201" / "202"
                    r["service_id"],
                    tidy(r["trip_headsign"]),
                )
    if not trips:
        sys.exit("No CTrain trips found — check route_id prefixes in routes.txt")

    # ---- departures at City Hall ------------------------------------------
    heads = []
    head_idx = {}
    departures = {STOP_WEST: collections.defaultdict(list),
                  STOP_EAST: collections.defaultdict(list)}

    with open(path("stop_times.txt"), newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            stop = r["stop_id"]
            if stop != STOP_WEST and stop != STOP_EAST:
                continue
            meta = trips.get(r["trip_id"])
            if not meta:
                continue
            secs = hms_to_seconds(r["departure_time"] or r["arrival_time"])
            if secs is None:
                continue
            route, service, headsign = meta
            if headsign not in head_idx:
                head_idx[headsign] = len(heads)
                heads.append(headsign)
            departures[stop][service].append([secs, route, head_idx[headsign]])

    for stop in departures:
        for service in departures[stop]:
            departures[stop][service].sort(key=lambda x: x[0])

    out = {
        "generated_from_gtfs": True,
        "valid_from": valid_from,
        "valid_to": valid_to,
        "calendar": calendar,
        "exceptions": exceptions,
        "headsigns": heads,
        "stops": {
            STOP_WEST: dict(departures[STOP_WEST]),
            STOP_EAST: dict(departures[STOP_EAST]),
        },
    }

    dest = "schedule.json"
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))

    total = sum(len(v) for s in departures.values() for v in s.values())
    print("Wrote %s" % dest)
    print("  valid %s - %s" % (valid_from, valid_to))
    print("  %d departures across %d service patterns" % (total, len(calendar)))
    print("  size: %.1f KB" % (os.path.getsize(dest) / 1024.0))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
