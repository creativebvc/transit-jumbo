// ==========================================
// SCHEDULE FALLBACK
// ------------------------------------------
// Reads scripts/schedule.json (built from Calgary's static GTFS by
// build-schedule.py) and produces scheduled departures for City Hall.
//
// This exists because Calgary's realtime TripUpdates feed intermittently
// stops publishing CTrain (LRT) trips while continuing to publish buses.
// When that happens the board falls back to scheduled times instead of
// going blank. It reverts to realtime automatically the moment the feed
// starts carrying trains again.
//
// XMLHttpRequest rather than fetch, var rather than let/const, and classic
// loops — consistent with the rest of the BVCTV TV-browser pattern.
// ==========================================

var SCHEDULE_DATA = null;
var SCHEDULE_STATE = "unloaded"; // unloaded | ready | failed

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
                console.log("🗓️ Schedule fallback loaded (valid " +
                            SCHEDULE_DATA.valid_from + "–" + SCHEDULE_DATA.valid_to + ")");
            } catch (e) {
                SCHEDULE_STATE = "failed";
                console.error("Schedule JSON parse failed:", e);
            }
        } else {
            SCHEDULE_STATE = "failed";
            console.warn("Schedule JSON unavailable (HTTP " + xhr.status + ")");
        }
        if (callback) callback(SCHEDULE_DATA);
    };
    try { xhr.send(); } catch (e) {
        SCHEDULE_STATE = "failed";
        if (callback) callback(null);
    }
}

function ymd(dateObj) {
    var m = dateObj.getMonth() + 1;
    var d = dateObj.getDate();
    return "" + dateObj.getFullYear() +
           (m < 10 ? "0" : "") + m +
           (d < 10 ? "0" : "") + d;
}

function checkScheduleFreshness() {
    if (!SCHEDULE_DATA) return;
    var today = ymd(new Date());
    if (today > SCHEDULE_DATA.valid_to) {
        console.warn("⚠️ schedule.json expired on " + SCHEDULE_DATA.valid_to +
                     " — re-run build-schedule.py with the latest Calgary GTFS");
    }
}

// Which service_id applies on a given date? Honours calendar_dates exceptions
// (type 1 = service added that day, type 2 = service removed that day).
function serviceIdsForDate(dateObj) {
    if (!SCHEDULE_DATA) return [];
    var dateStr = ymd(dateObj);
    var dow = dateObj.getDay(); // 0 = Sunday
    var active = {};
    var sid;

    for (sid in SCHEDULE_DATA.calendar) {
        if (!SCHEDULE_DATA.calendar.hasOwnProperty(sid)) continue;
        var c = SCHEDULE_DATA.calendar[sid];
        if (dateStr < c.start || dateStr > c.end) continue;
        if (c.days[dow] === 1) active[sid] = true;
    }

    var ex = SCHEDULE_DATA.exceptions || [];
    for (var i = 0; i < ex.length; i++) {
        if (ex[i].date !== dateStr) continue;
        if (ex[i].type === 1) active[ex[i].service] = true;
        else if (ex[i].type === 2) delete active[ex[i].service];
    }

    var out = [];
    for (sid in active) {
        if (active.hasOwnProperty(sid)) out.push(sid);
    }
    return out;
}

function collectDepartures(stopId, serviceIds) {
    var list = [];
    if (!SCHEDULE_DATA || !SCHEDULE_DATA.stops[stopId]) return list;
    for (var i = 0; i < serviceIds.length; i++) {
        var rows = SCHEDULE_DATA.stops[stopId][serviceIds[i]];
        if (!rows) continue;
        for (var j = 0; j < rows.length; j++) list.push(rows[j]);
    }
    return list;
}

// Returns up to `limit` upcoming departures for one platform.
// Each entry matches the shape parseTrainsFromFeed produces, plus scheduled:true.
function getScheduledDepartures(stopId, limit) {
    if (SCHEDULE_STATE !== "ready") return [];

    var now = new Date();
    var nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    var candidates = [];
    var i, row, mins;

    // Today's service, departures still ahead of us
    var todayServices = serviceIdsForDate(now);
    var todayRows = collectDepartures(stopId, todayServices);
    for (i = 0; i < todayRows.length; i++) {
        row = todayRows[i];
        if (row[0] >= nowSecs - 60) {
            candidates.push([row[0] - nowSecs, row[1], row[2]]);
        }
    }

    // Yesterday's service can run past midnight (GTFS times above 24:00:00),
    // so just after midnight the relevant rows belong to the previous day.
    var yesterday = new Date(now.getTime() - 86400000);
    var yRows = collectDepartures(stopId, serviceIdsForDate(yesterday));
    for (i = 0; i < yRows.length; i++) {
        row = yRows[i];
        if (row[0] >= 86400) {
            var offset = row[0] - 86400 - nowSecs;
            if (offset >= -60) candidates.push([offset, row[1], row[2]]);
        }
    }

    candidates.sort(function (a, b) { return a[0] - b[0]; });

    var out = [];
    for (i = 0; i < candidates.length && out.length < (limit || 4); i++) {
        mins = Math.max(0, Math.round(candidates[i][0] / 60));
        if (mins > 90) break;
        out.push({
            destination: SCHEDULE_DATA.headsigns[candidates[i][2]],
            line: candidates[i][1] === "201" ? "red" : "blue",
            minutes: mins,
            status: "Scheduled",
            scheduled: true
        });
    }
    return out;
}
