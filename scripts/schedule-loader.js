// ==========================================
// SCHEDULE FALLBACK
// ------------------------------------------
// Reads scripts/schedule.json (built by build-schedule.py from Calgary's static
// GTFS) and yields scheduled departures for City Hall in the same shape the
// engine uses for realtime arrivals, so the two can be merged.
//
// Rows carry trip_id, which lets the engine drop a scheduled row when the same
// trip is already present live.
// ==========================================

var SCHEDULE_DATA = null;
var SCHEDULE_STATE = "unloaded";   // unloaded | ready | failed

function loadScheduleData(callback) {
    if (SCHEDULE_STATE === "ready" || SCHEDULE_STATE === "failed") {
        if (callback) callback(SCHEDULE_DATA);
        return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "scripts/schedule.json", true);
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                SCHEDULE_DATA = JSON.parse(xhr.responseText);
                SCHEDULE_STATE = "ready";
                checkScheduleFreshness();
                console.log("Schedule fallback loaded (valid " +
                            SCHEDULE_DATA.valid_from + "-" + SCHEDULE_DATA.valid_to + ")");
            } catch (e) {
                SCHEDULE_STATE = "failed";
                console.error("schedule.json parse failed:", e);
            }
        } else {
            SCHEDULE_STATE = "failed";
            console.warn("schedule.json unavailable (HTTP " + xhr.status + ")");
        }
        if (callback) callback(SCHEDULE_DATA);
    };
    try { xhr.send(); } catch (e) {
        SCHEDULE_STATE = "failed";
        if (callback) callback(null);
    }
}

function _ymd(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return "" + d.getFullYear() + (m < 10 ? "0" : "") + m + (day < 10 ? "0" : "") + day;
}

function checkScheduleFreshness() {
    if (!SCHEDULE_DATA) return;
    if (_ymd(new Date()) > SCHEDULE_DATA.valid_to) {
        console.warn("schedule.json expired on " + SCHEDULE_DATA.valid_to +
                     " - re-run build-schedule.py with the latest Calgary GTFS");
    }
}

// Which service_ids run on a given date, honouring calendar_dates exceptions
// (type 1 = added that day, type 2 = removed that day).
function _servicesFor(dateObj) {
    if (!SCHEDULE_DATA) return [];
    var dateStr = _ymd(dateObj), dow = dateObj.getDay(), active = {}, sid, i;

    for (sid in SCHEDULE_DATA.calendar) {
        if (!SCHEDULE_DATA.calendar.hasOwnProperty(sid)) continue;
        var c = SCHEDULE_DATA.calendar[sid];
        if (dateStr < c.start || dateStr > c.end) continue;
        if (c.days[dow] === 1) active[sid] = true;
    }

    var ex = SCHEDULE_DATA.exceptions || [];
    for (i = 0; i < ex.length; i++) {
        if (ex[i].date !== dateStr) continue;
        if (ex[i].type === 1) active[ex[i].service] = true;
        else if (ex[i].type === 2) delete active[ex[i].service];
    }

    var out = [];
    for (sid in active) if (active.hasOwnProperty(sid)) out.push(sid);
    return out;
}

function _midnightMs(dateObj) {
    var d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0, 0);
    return d.getTime();
}

// Returns scheduled departures for BOTH platforms as engine-shaped items.
// Yesterday's services are included because GTFS times run past 24:00:00,
// so just after midnight the relevant rows belong to the previous service day.
function getScheduledArrivals(nowMs, lookaheadMin) {
    if (SCHEDULE_STATE !== "ready") return [];

    var horizon = nowMs + (lookaheadMin || 60) * 60000;
    var today = new Date(nowMs);
    var yesterday = new Date(nowMs - 86400000);
    var days = [
        { date: yesterday, base: _midnightMs(yesterday) },
        { date: today,     base: _midnightMs(today) }
    ];

    var DEST = {
        "6822": { "201": "Tuscany",             "202": "69 St Station" },
        "6831": { "201": "Somerset-Bridlewood", "202": "Saddletowne" }
    };

    var out = [], stops = ["6822", "6831"], d, s, svc, si, k, rows, r;

    for (d = 0; d < days.length; d++) {
        svc = _servicesFor(days[d].date);
        if (!svc.length) continue;

        for (s = 0; s < stops.length; s++) {
            var stopId = stops[s];
            var byStop = SCHEDULE_DATA.stops[stopId];
            if (!byStop) continue;

            for (si = 0; si < svc.length; si++) {
                rows = byStop[svc[si]];
                if (!rows) continue;

                for (k = 0; k < rows.length; k++) {
                    r = rows[k];                       // [secs, route, headsignIdx, tripId]
                    var ms = days[d].base + r[0] * 1000;
                    if (ms < nowMs - 60000 || ms > horizon) continue;

                    var dest = SCHEDULE_DATA.headsigns[r[2]];
                    if (!dest && DEST[stopId]) dest = DEST[stopId][r[1]];

                    out.push({
                        tripId: r[3] || "",
                        stopId: stopId,
                        route: r[1],
                        destination: dest,
                        predictedMs: ms,
                        scheduledMs: ms,
                        delaySec: null,
                        source: "scheduled"
                    });
                }
            }
        }
    }

    out.sort(function (a, b) { return a.predictedMs - b.predictedMs; });
    return out;
}
