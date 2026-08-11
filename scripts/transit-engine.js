// ==========================================
// TRANSIT ENGINE v12
// ------------------------------------------
// Realtime primary, scheduled fallback, merged PER STOP AND ROUTE rather than
// swapped wholesale. If Calgary restores only one line, the board shows live
// times for that line and scheduled times for the other, instead of forcing
// both into the same mode.
//
// Consumes GTFSDecoder output directly. ES5 for TV browsers: no arrow
// functions, no optional chaining, no template literals in logic paths.
// ==========================================

var STOP_CITY_HALL_WEST = "6822";
var STOP_CITY_HALL_EAST = "6831";
var ROUTE_RED  = "201";
var ROUTE_BLUE = "202";

var MAX_LOOKAHEAD_MIN = 60;
var DEDUPE_WINDOW_MS  = 180000;   // 3 min: a scheduled row this close to a live
                                  // prediction for the same stop+route is the
                                  // same train, so the live one wins.

// ==========================================
// HELPERS
// ==========================================

function num(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") return parseInt(v, 10) || 0;
    if (typeof v.toNumber === "function") return v.toNumber();
    if (v.low !== undefined) return v.low;
    return 0;
}

function routeOf(routeId) {
    if (!routeId) return null;
    if (routeId.indexOf(ROUTE_RED) > -1)  return ROUTE_RED;
    if (routeId.indexOf(ROUTE_BLUE) > -1) return ROUTE_BLUE;
    return null;
}

function lineColorOf(route) { return route === ROUTE_RED ? "red" : "blue"; }

function titleCase(s) {
    if (!s) return "";
    var words = s.toLowerCase().split(/\s+/), out = [], i, w;
    for (i = 0; i < words.length; i++) {
        w = words[i];
        if (!w) continue;
        if (w === "sw" || w === "nw" || w === "se" || w === "ne" || w === "st") {
            out.push(w.toUpperCase());
        } else {
            out.push(w.charAt(0).toUpperCase() + w.slice(1));
        }
    }
    return out.join(" ");
}

var DEFAULT_DEST = {
    "6822": { "201": "Tuscany",             "202": "69 St Station" },
    "6831": { "201": "Somerset-Bridlewood", "202": "Saddletowne" }
};

// ==========================================
// LIVE ARRIVALS
// ==========================================

function liveArrivals(feed, nowMs) {
    var out = [];
    if (!feed || !feed.updates) return out;

    var horizon = nowMs + MAX_LOOKAHEAD_MIN * 60000;
    var i, j;

    for (i = 0; i < feed.updates.length; i++) {
        var u = feed.updates[i];
        if (!u.trip) continue;

        var route = routeOf(u.trip.routeId);
        if (!route) continue;
        if (u.trip.scheduleRelationship === 3) continue;   // CANCELED

        var stops = u.stopTimeUpdates || [];
        for (j = 0; j < stops.length; j++) {
            var stu = stops[j];
            var stopId = stu.stopId;
            if (stopId !== STOP_CITY_HALL_WEST && stopId !== STOP_CITY_HALL_EAST) continue;
            if (stu.scheduleRelationship === 1) continue;   // SKIPPED

            var ev = (stu.departure && stu.departure.time) ? stu.departure : stu.arrival;
            if (!ev || !ev.time) continue;

            var predictedMs = num(ev.time) * 1000;
            if (predictedMs < nowMs - 45000 || predictedMs > horizon) continue;

            var delaySec = (ev.delay === null || ev.delay === undefined) ? null : ev.delay;
            var scheduledMs = (delaySec !== null) ? predictedMs - delaySec * 1000 : null;

            out.push({
                tripId: u.trip.tripId || "",
                stopId: stopId,
                route: route,
                destination: DEFAULT_DEST[stopId][route],
                predictedMs: predictedMs,
                scheduledMs: scheduledMs,
                delaySec: delaySec,
                source: "realtime"
            });
        }
    }
    return out;
}

// ==========================================
// MERGE
// ==========================================
// A scheduled row is dropped when the same trip is already live, or when a
// live prediction for the same stop and route sits within the dedupe window.
// Everything else is kept, so gaps fill without duplicating trains.

function mergeArrivals(live, scheduled) {
    var liveTripIds = {}, i, j;
    for (i = 0; i < live.length; i++) {
        if (live[i].tripId) liveTripIds[live[i].tripId] = true;
    }

    var merged = live.slice();

    for (i = 0; i < scheduled.length; i++) {
        var s = scheduled[i];
        if (s.tripId && liveTripIds[s.tripId]) continue;

        var duplicate = false;
        for (j = 0; j < live.length; j++) {
            var l = live[j];
            if (l.stopId !== s.stopId || l.route !== s.route) continue;
            var ref = (l.scheduledMs !== null && l.scheduledMs !== undefined)
                    ? l.scheduledMs : l.predictedMs;
            if (Math.abs(ref - s.scheduledMs) <= DEDUPE_WINDOW_MS) { duplicate = true; break; }
        }
        if (!duplicate) merged.push(s);
    }

    merged.sort(function (a, b) { return a.predictedMs - b.predictedMs; });
    return merged;
}

function toCards(items, stopId, nowMs, limit) {
    var out = [], i;
    for (i = 0; i < items.length && out.length < limit; i++) {
        var it = items[i];
        if (it.stopId !== stopId) continue;

        var mins = Math.max(0, Math.round((it.predictedMs - nowMs) / 60000));
        var status;
        if (it.source === "scheduled") {
            status = "Scheduled";
        } else if (it.delaySec !== null && it.delaySec >= 180) {
            status = "Delayed";
        } else if (mins <= 1) {
            status = "Boarding";
        } else {
            status = "On Time";
        }

        out.push({
            destination: it.destination,
            line: lineColorOf(it.route),
            minutes: mins,
            status: status,
            scheduled: it.source === "scheduled"
        });
    }
    return out;
}

// ==========================================
// FEED HEALTH
// ==========================================
// Counts CTrain trips across the whole feed. This is what separates "no trains
// due right now" (correct, and still live) from "Calgary stopped publishing
// LRT" (a feed failure). The two look identical on screen otherwise.

function feedHealth(feed, nowMs) {
    var out = { reachable: false, updates: 0, ctrainTrips: 0, age: "?" };
    if (!feed || !feed.updates) return out;
    out.reachable = true;
    out.updates = feed.updates.length;

    var ts = (feed.header && feed.header.timestamp) ? num(feed.header.timestamp) : 0;
    if (ts > 0) out.age = Math.floor(nowMs / 1000) - ts;

    for (var i = 0; i < feed.updates.length; i++) {
        var u = feed.updates[i];
        if (u.trip && routeOf(u.trip.routeId)) out.ctrainTrips++;
    }
    return out;
}

// ==========================================
// ALERTS
// ==========================================

// Every CTrain station except ours. Calgary scopes station-specific notices to
// the whole route (the Crowfoot elevator alert is informed_entity route_id
// "201", with no stop selector), so a route-level alert naming another station
// would otherwise appear on this board despite being irrelevant here.
var OTHER_STATIONS = [
    "1 street", "3 street", "4 street", "6 street", "7 street", "8 street",
    "39 avenue", "45 street", "69 street", "anderson", "banff trail",
    "barlow", "max bell", "brentwood", "bridgeland", "memorial",
    "canyon meadows", "centre street", "chinook", "crowfoot", "dalhousie",
    "downtown west", "west kerby", "erlton", "stampede", "fish creek",
    "lacombe", "franklin", "heritage", "lions park", "marlborough",
    "martindale", "mcknight", "westwinds", "rundle", "sait", "auarts",
    "jubilee", "saddletowne", "shaganappi", "shawnessy", "sirocco",
    "somerset", "bridlewood", "southland", "sunalta", "sunnyside",
    "tuscany", "university", "victoria park", "westbrook", "whitehorn", "zoo"
];

// Names that mean this station, in any of the forms Calgary writes them.
var OUR_STATION = ["city hall", "bow valley"];

function mentionsOurStation(lower) {
    for (var i = 0; i < OUR_STATION.length; i++) {
        if (lower.indexOf(OUR_STATION[i]) > -1) return true;
    }
    return false;
}

function mentionsOtherStation(lower) {
    for (var i = 0; i < OTHER_STATIONS.length; i++) {
        if (lower.indexOf(OTHER_STATIONS[i]) > -1) return true;
    }
    return false;
}

function stripHtml(s) {
    if (!s) return "";
    return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// Alerts are ranked, not just filtered:
//   2 = scoped to one of our stops, or names this station     -> always show
//   1 = line-wide, names no specific station                  -> show
//   0 = names another station and not ours                    -> suppress
function alertRelevance(a, text) {
    var lower = text.toLowerCase();
    var i, sel;

    for (i = 0; i < (a.selectors || []).length; i++) {
        sel = a.selectors[i];
        if (sel.stopId === STOP_CITY_HALL_WEST || sel.stopId === STOP_CITY_HALL_EAST) return 2;
    }
    if (mentionsOurStation(lower)) return 2;
    if (mentionsOtherStation(lower)) return 0;
    return 1;
}

function ctrainAlertText(feed, nowMs) {
    if (!feed || !feed.alerts) return null;
    var nowSec = Math.floor(nowMs / 1000);
    var best = null, bestRank = 0;
    var i, j;

    for (i = 0; i < feed.alerts.length; i++) {
        var a = feed.alerts[i];

        var touchesUs = false;
        for (j = 0; j < (a.selectors || []).length; j++) {
            var sel = a.selectors[j];
            if (routeOf(sel.routeId)) { touchesUs = true; break; }
            if (sel.stopId === STOP_CITY_HALL_WEST || sel.stopId === STOP_CITY_HALL_EAST) {
                touchesUs = true; break;
            }
        }
        if (!touchesUs) continue;

        // Respect active_period so expired notices do not linger.
        var periods = a.activePeriods || [];
        if (periods.length) {
            var active = false;
            for (j = 0; j < periods.length; j++) {
                var st = periods[j].start, en = periods[j].end;
                if ((!st || nowSec >= st) && (!en || nowSec <= en)) { active = true; break; }
            }
            if (!active) continue;
        }

        var msg = stripHtml(a.header) || stripHtml(a.description);
        if (!msg) continue;

        var rank = alertRelevance(a, msg);
        if (rank === 0) continue;

        if (rank > bestRank) {
            bestRank = rank;
            best = msg;
            if (rank === 2) break;   // nothing outranks a stop-scoped alert
        }
    }

    if (!best) return null;
    if (best.length > 220) best = best.slice(0, 217) + "...";
    return best;
}

function renderAlertBanner(msg) {
    var footer = document.getElementById("service-footer");
    var span = document.getElementById("service-text");
    if (!footer || !span) return;
    if (msg) {
        span.innerText = "SERVICE ALERT: " + msg;
        footer.className = "status-alert";
    } else {
        span.innerText = "Normal Service: All trains running on schedule.";
        footer.className = "status-ok";
    }
}

// The header reads "Live Departures". Showing that above scheduled-only data
// would be a false claim, so the label follows the actual data source.
var _headerMode = null;
function setHeaderMode(mode) {
    if (_headerMode === mode) return;
    _headerMode = mode;
    var el = document.querySelector(".live-status");
    if (!el) return;
    var dot = document.getElementById("live-indicator");
    el.innerHTML = "";
    if (dot) el.appendChild(dot);
    el.appendChild(document.createTextNode(
        mode === "scheduled" ? " Scheduled Departures" : " Live Departures"));
}

// ==========================================
// ENGINE
// ==========================================

function startTransitDashboard() {
    console.log("TRANSIT ENGINE v12 - realtime + merged schedule fallback");

    var liveDot = document.getElementById("live-indicator");
    var cardLimit = 4;
    var renderedTrains = false;

    function paint(mergedItems, health, nowMs) {
        var west = toCards(mergedItems, STOP_CITY_HALL_WEST, nowMs, cardLimit);
        var east = toCards(mergedItems, STOP_CITY_HALL_EAST, nowMs, cardLimit);

        window.renderColumn("westbound-container", west);
        window.renderColumn("eastbound-container", east);

        var anyLive = false, i;
        for (i = 0; i < mergedItems.length; i++) {
            if (mergedItems[i].source === "realtime") { anyLive = true; break; }
        }

        var mode = (health.reachable && health.ctrainTrips > 0) ? "live" : "scheduled";
        setHeaderMode(mode);
        if (liveDot) {
            if (mode === "live") liveDot.classList.remove("stale");
            else liveDot.classList.add("stale");
        }

        renderedTrains = (west.length + east.length) > 0;

        console.log((mode === "live" ? "LIVE - " : "SCHEDULED - ") +
                    west.length + "W / " + east.length + "E | feed: " +
                    health.updates + " updates, " + health.ctrainTrips +
                    " CTrain trips, age " + health.age + "s" +
                    (anyLive ? "" : " | all rows from timetable"));
    }

    function update() {
        var nowMs = Date.now();
        if (liveDot) liveDot.classList.add("stale");

        return Promise.all([getTripUpdates(), getAlerts()]).then(function (res) {
            var tripFeed = res[0], alertFeed = res[1];
            var health = feedHealth(tripFeed, nowMs);

            var live = liveArrivals(tripFeed, nowMs);
            var scheduled = (typeof getScheduledArrivals === "function")
                          ? getScheduledArrivals(nowMs, MAX_LOOKAHEAD_MIN) : [];

            paint(mergeArrivals(live, scheduled), health, nowMs);
            renderAlertBanner(ctrainAlertText(alertFeed, nowMs));
        })["catch"](function (err) {
            console.error("Engine update error:", err);
            if (liveDot) liveDot.classList.add("stale");
        });
    }

    // schedule.json loads asynchronously, so the first update() can run before
    // it is available. If that left the board empty, repaint the moment it
    // lands rather than waiting out the 30s cycle.
    if (typeof loadScheduleData === "function") {
        loadScheduleData(function () {
            if (!renderedTrains) update();
        });
    }

    update();
    setInterval(update, 30000);
}
